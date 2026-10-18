import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startConnector, type Connector } from '../src/server';
import { FakeAdapter } from './helpers/fakeAdapter';

const ORIGIN = 'http://localhost:5173';
const CODE = '123456';
const SECRET = 'segredo-de-teste-bem-longo-0123456789';

let fake: FakeAdapter;
let conn: Connector;
let clock = 1_000_000;

async function boot(extra: Partial<Parameters<typeof startConnector>[0]> = {}) {
  fake = new FakeAdapter();
  conn = await startConnector({ adapter: fake, origins: [ORIGIN], pairCode: CODE, secret: SECRET, now: () => clock, ...extra });
}
afterEach(async () => {
  await conn?.close();
});

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
  raw: Buffer;
}
/** Raw HTTP so the Host header can be forged (fetch forbids it). */
function call(method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown; host?: string; token?: string | null; origin?: string | null } = {}): Promise<Res> {
  const headers: Record<string, string> = { Host: opts.host ?? `127.0.0.1:${conn.port}`, ...opts.headers };
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.Origin = origin;
  const token = opts.token === undefined ? SECRET : opts.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: string | undefined;
  if (opts.body !== undefined) {
    payload = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    headers['Content-Type'] ??= 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(payload));
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: conn.port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let body: any = null;
        try {
          body = JSON.parse(raw.toString('utf8'));
        } catch {
          /* binary */
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('segurança do conector', () => {
  beforeEach(() => boot());

  it('só escuta em 127.0.0.1', () => {
    const addr = conn.server.address() as { address: string };
    expect(addr.address).toBe('127.0.0.1');
  });

  it('exige o token em toda chamada', async () => {
    for (const [m, p] of [['GET', '/v1/status'], ['POST', '/v1/next'], ['POST', '/v1/open'], ['GET', '/v1/export'], ['GET', '/v1/slides/1/thumb'], ['POST', '/v1/end']] as const) {
      const r = await call(m, p, { token: null, body: m === 'POST' ? {} : undefined });
      expect(r.status, `${m} ${p}`).toBe(401);
    }
    expect((await call('GET', '/v1/status', { token: 'errado' })).status).toBe(401);
    expect(fake.calls).toEqual([]);
  });

  it('rejeita origem não permitida (inclusive no preflight) e não manda CORS', async () => {
    const r = await call('GET', '/v1/status', { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    const pre = await call('OPTIONS', '/v1/next', { origin: 'https://evil.example', token: null, headers: { 'Access-Control-Request-Method': 'POST' } });
    expect(pre.status).toBe(403);
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejeita Host diferente de loopback:porta (DNS rebinding)', async () => {
    expect((await call('GET', '/v1/status', { host: 'evil.example' })).status).toBe(403);
    expect((await call('GET', '/v1/status', { host: `evil.example:${conn.port}` })).status).toBe(403);
    expect((await call('GET', '/v1/status', { host: '127.0.0.1:1' })).status).toBe(403);
    expect((await call('GET', '/v1/status', { host: `localhost:${conn.port}` })).status).toBe(200);
  });

  it('preflight devolve CORS e Private Network Access para a origem permitida', async () => {
    const r = await call('OPTIONS', '/v1/next', { token: null, headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Private-Network': 'true' } });
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(r.headers['access-control-allow-private-network']).toBe('true');
    expect(String(r.headers['access-control-allow-headers'])).toContain('Authorization');
    expect(r.headers.vary).toContain('Origin');
  });

  it('pareamento: código certo devolve o token, errado não', async () => {
    const bad = await call('POST', '/v1/pair', { token: null, body: { code: '000000' } });
    expect(bad.status).toBe(401);
    expect(bad.body.token).toBeUndefined();
    const ok = await call('POST', '/v1/pair', { token: null, body: { code: '123 456' } });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBe(SECRET);
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('pareamento exige Origin e limita tentativas erradas', async () => {
    expect((await call('POST', '/v1/pair', { token: null, origin: null, body: { code: CODE } })).status).toBe(403);
    for (let i = 0; i < 5; i++) expect((await call('POST', '/v1/pair', { token: null, body: { code: '999999' } })).status).toBe(401);
    // Locked out, even with the right code.
    const locked = await call('POST', '/v1/pair', { token: null, body: { code: CODE } });
    expect(locked.status).toBe(429);
    expect(locked.headers['retry-after']).toBeDefined();
    clock += 61_000;
    expect((await call('POST', '/v1/pair', { token: null, body: { code: CODE } })).status).toBe(200);
  });

  it('troca o código depois de muitas tentativas erradas', async () => {
    const first = conn.pairCode();
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 5; i++) await call('POST', '/v1/pair', { token: null, body: { code: 'xxxxxx' } });
      clock += 61_000;
    }
    expect(conn.pairCode()).not.toBe(first);
    expect(conn.pairCode()).toMatch(/^\d{6}$/);
  });

  it('limita a taxa de pedidos', async () => {
    await conn.close();
    await boot({ ratePerSecond: 2 }); // burst of 4
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await call('GET', '/v1/status')).status);
    expect(statuses.filter((s) => s === 200).length).toBe(4);
    expect(statuses.filter((s) => s === 429).length).toBe(4);
    clock += 3000;
    expect((await call('GET', '/v1/status')).status).toBe(200);
  });

  it('corpo pequeno, JSON obrigatório e rotas inexistentes', async () => {
    expect((await call('POST', '/v1/goto', { body: { index: 2, junk: 'x'.repeat(5000) } })).status).toBe(413);
    expect((await call('POST', '/v1/goto', { body: '{ruim', headers: { 'Content-Type': 'application/json' } })).status).toBe(400);
    expect((await call('POST', '/v1/goto', { body: 'index=2', headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    expect((await call('POST', '/v1/run', { body: { cmd: 'calc.exe' } })).status).toBe(404);
    expect((await call('POST', '/v1/exec', { body: { script: 'whoami' } })).status).toBe(404);
    expect((await call('GET', '/v1/../etc/passwd')).status).toBe(404);
    expect(fake.calls).toEqual([]);
  });

  it('valida argumentos (nada de caminhos ou valores soltos)', async () => {
    expect((await call('POST', '/v1/start', { body: { mode: 'rm -rf' } })).status).toBe(400);
    expect((await call('POST', '/v1/goto', { body: { index: '3' } })).status).toBe(400);
    expect((await call('POST', '/v1/goto', { body: { index: -1 } })).status).toBe(400);
    expect((await call('POST', '/v1/pointer', { body: { mode: 'x' } })).status).toBe(400);
    expect((await call('POST', '/v1/export', { body: { width: 10 } })).status).toBe(400);
    expect((await call('POST', '/v1/open', { body: { path: 'C:\\Windows\\win.ini' } })).status).toBe(200); // ignored: the file comes from the dialog
    expect(fake.calls[0]).toBe('open');
    expect(fake.calls.filter((c) => !c.startsWith('export:') && c !== 'open')).toEqual([]);
  });

  it('o log não contém token nem código', async () => {
    await conn.close();
    const lines: string[] = [];
    await boot({ log: (l) => lines.push(l) });
    await call('POST', '/v1/pair', { token: null, body: { code: CODE } });
    await call('GET', '/v1/status');
    await call('GET', '/v1/status', { token: 'errado' });
    const all = lines.join('\n');
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(CODE);
    expect(all).not.toContain('errado');
  });
});

describe('ações do conector (adaptador falso)', () => {
  beforeEach(() => boot());

  it('status sem PowerPoint, sem apresentação', async () => {
    fake.app = false;
    let r = await call('GET', '/v1/status');
    expect(r.status).toBe(200);
    expect(r.body.app).toBe(false);
    expect(r.body.capabilities.adapter).toBe('fake');
    fake.app = true;
    r = await call('GET', '/v1/status');
    expect(r.body).toMatchObject({ app: true, presentation: null, show: null, index: 0 });
  });

  it('erros do PowerPoint viram HTTP 409 com código estável', async () => {
    const r = await call('POST', '/v1/next', { body: {} });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('no_show');
    fake.app = false;
    const r2 = await call('POST', '/v1/start', { body: {} });
    expect(r2.body.error.code).toBe('no_powerpoint');
    fake.app = true;
    const r3 = await call('POST', '/v1/start', { body: {} });
    expect(r3.body.error.code).toBe('no_presentation');
  });

  it('abrir (diálogo), iniciar, navegar, ir ao slide, tela preta e ponteiro', async () => {
    const open = await call('POST', '/v1/open', { body: {} });
    expect(open.body.opened).toBe(true);
    expect(open.body.status.presentation).toEqual({ name: 'demo.pptx', slides: 5 });
    const start = await call('POST', '/v1/start', { body: { mode: 'window' } });
    expect(start.body.status.show).toMatchObject({ state: 'running', mode: 'window' });
    expect((await call('POST', '/v1/next', { body: {} })).body.status.index).toBe(2);
    expect((await call('POST', '/v1/prev', { body: {} })).body.status.index).toBe(1);
    expect((await call('POST', '/v1/goto', { body: { index: 4 } })).body.status).toMatchObject({ index: 4, title: 'Titulo 4', notes: 'Notas 4' });
    expect((await call('POST', '/v1/last', { body: {} })).body.status.index).toBe(5);
    expect((await call('POST', '/v1/first', { body: {} })).body.status.index).toBe(1);
    expect((await call('POST', '/v1/blank', { body: { kind: 'black' } })).body.status.show.state).toBe('black');
    expect((await call('POST', '/v1/blank', { body: { kind: 'black' } })).body.status.show.state).toBe('running');
    expect((await call('POST', '/v1/pointer', { body: { mode: 'laser' } })).body.status.show.pointer).toBe('laser');
    expect((await call('POST', '/v1/goto', { body: { index: 99 } })).status).toBe(400);
    expect((await call('POST', '/v1/end', { body: {} })).body.status.show).toBeNull();
  });

  it('cancelar o diálogo não abre nada', async () => {
    fake.dialogResult = null;
    const r = await call('POST', '/v1/open', { body: {} });
    expect(r.body.opened).toBe(false);
    expect(r.body.status.presentation).toBeNull();
  });

  it('exporta slides e miniaturas e só serve esses arquivos', async () => {
    await call('POST', '/v1/open', { body: {} });
    // thumbnails appear by themselves
    for (let i = 0; i < 50; i++) {
      const s = await call('GET', '/v1/status');
      if (s.body.thumbs.ready === 5) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const thumbs = (await call('GET', '/v1/status')).body.thumbs;
    expect(thumbs).toMatchObject({ ready: 5, total: 5 });
    const thumb = await call('GET', '/v1/slides/3/thumb');
    expect(thumb.status).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/jpeg');
    expect(thumb.raw.length).toBeGreaterThan(0);

    const start = await call('POST', '/v1/export', { body: { width: 1600, format: 'png' } });
    expect(start.status).toBe(200);
    let prog = start.body;
    for (let i = 0; i < 100 && prog.state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      prog = (await call('GET', '/v1/export')).body;
    }
    expect(prog).toMatchObject({ state: 'done', ready: 5, total: 5, width: 1600, format: 'png' });
    const full = await call('GET', '/v1/slides/5/full');
    expect(full.headers['content-type']).toBe('image/png');
    expect(full.raw.length).toBeGreaterThan(0);
    expect((await call('GET', '/v1/slides/6/full')).status).toBe(404);
    expect((await call('GET', '/v1/slides/1/..%2f..%2fsecret')).status).toBe(404);
  });

  it('falha de exportação aparece no progresso', async () => {
    await call('POST', '/v1/open', { body: {} });
    fake.failExportAt = 3;
    await call('POST', '/v1/export', { body: { width: 800, format: 'jpeg' } });
    let prog: any;
    for (let i = 0; i < 100; i++) {
      prog = (await call('GET', '/v1/export')).body;
      if (prog.state !== 'running') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(prog.state).toBe('error');
    expect(prog.ready).toBe(2);
    expect(typeof prog.error).toBe('string');
  });

  it('exportar sem apresentação responde 409', async () => {
    const r = await call('POST', '/v1/export', { body: {} });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('no_presentation');
  });
});
