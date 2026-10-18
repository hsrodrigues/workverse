/**
 * Real test with Microsoft PowerPoint (COM). Runs only on Windows with PowerPoint installed AND not already running
 * (so a session of the user is never disturbed). It creates a 5-slide deck, drives it through the connector over
 * HTTP and confirms every effect by asking PowerPoint itself with an independent COM call. Everything it opens is
 * closed at the end. Set WV_SKIP_COM=1 to skip it on purpose.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startConnector, type Connector } from '../src/server';
import { PowerPointAdapter } from '../src/powershell';

function sh(script: string, timeout = 60_000): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', timeout, windowsHide: true }).trim();
}

function comAvailable(): boolean {
  if (process.platform !== 'win32' || process.env.WV_SKIP_COM === '1') return false;
  try {
    execFileSync('reg', ['query', 'HKCR\\PowerPoint.Application\\CLSID'], { stdio: 'ignore', windowsHide: true });
    const running = execFileSync('tasklist', ['/FI', 'IMAGENAME eq POWERPNT.EXE', '/NH'], { encoding: 'utf8', windowsHide: true });
    return !/POWERPNT\.EXE/i.test(running);
  } catch {
    return false;
  }
}

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ORIGIN = 'http://localhost:5173';
const CODE = '246810';

describe.skipIf(!comAvailable())('PowerPoint real (COM)', () => {
  let dir: string;
  let pptx: string;
  let conn: Connector;
  let token = '';
  let createdMtime = 0;
  let createdSize = 0;

  const api = async (method: string, p: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${conn.port}${p}`, {
      method,
      headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, json: type.includes('json') ? ((await res.json()) as any) : null, bytes: type.includes('json') ? null : Buffer.from(await res.arrayBuffer()), type };
  };
  /** Independent check: asks PowerPoint directly which slide the running show is on. */
  const realIndex = () => Number(sh("$a=[System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application'); $a.SlideShowWindows.Item(1).View.Slide.SlideIndex"));
  const realShowCount = () => Number(sh("$a=[System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application'); $a.SlideShowWindows.Count"));

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-ppt-test-'));
    pptx = path.join(dir, 'WorkVerse Teste Ação.pptx'); // accents on purpose
    sh(`& '${path.join(here, 'helpers', 'make-deck.ps1')}' -Out '${pptx}'`);
    createdMtime = fs.statSync(pptx).mtimeMs;
    createdSize = fs.statSync(pptx).size;
    // Same adapter as production; only the native dialog is replaced by the file the test created.
    const adapter = new PowerPointAdapter(path.join(dir, 'exports'), async () => pptx);
    conn = await startConnector({ adapter, origins: [ORIGIN], pairCode: CODE, exportRoot: path.join(dir, 'exports') });
    const pair = await fetch(`http://127.0.0.1:${conn.port}/v1/pair`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: CODE }) });
    token = ((await pair.json()) as { token: string }).token;
  }, 120_000);

  afterAll(async () => {
    try {
      await conn?.close();
    } catch {
      /* ignore */
    }
    // Close only what this test opened, then quit PowerPoint (the test only runs when none was running before).
    try {
      sh(
        `$a=$null; try { $a=[System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { if (Get-Process POWERPNT -ErrorAction SilentlyContinue) { $a = New-Object -ComObject PowerPoint.Application } }; if ($a) {` +
          ` try { while ($a.SlideShowWindows.Count -gt 0) { $a.SlideShowWindows.Item(1).View.Exit() } } catch {};` +
          ` try { for ($i = $a.Presentations.Count; $i -ge 1; $i--) { $p = $a.Presentations.Item($i); if ($p.FullName -like '${dir.replace(/'/g, "''")}*') { $p.Saved = -1; $p.Close() } } } catch {};` +
          ` if ($a.Presentations.Count -eq 0) { $a.Quit() } }`,
      );
    } catch (e) {
      console.warn('limpeza do PowerPoint falhou:', (e as Error).message);
    }
    // Last resort: anything still alive was started by this test.
    for (let i = 0; i < 20; i++) {
      const alive = execFileSync('tasklist', ['/FI', 'IMAGENAME eq POWERPNT.EXE', '/NH'], { encoding: 'utf8', windowsHide: true });
      if (!/POWERPNT\.EXE/i.test(alive)) break;
      if (i === 19) execFileSync('taskkill', ['/IM', 'POWERPNT.EXE', '/F'], { stdio: 'ignore', windowsHide: true });
      await new Promise((r) => setTimeout(r, 500));
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }, 60_000);

  it('status antes de abrir: PowerPoint em execução só depois do open', async () => {
    const r = await api('GET', '/v1/status');
    expect(r.status).toBe(200);
    expect(r.json.presentation).toBeNull();
    const err = await api('POST', '/v1/next', {});
    expect(err.status).toBe(409);
    expect(['no_powerpoint', 'no_show']).toContain(err.json.error.code);
  }, 30_000);

  it('abre o arquivo, inicia em janela, navega e confere com o PowerPoint de verdade', async () => {
    const open = await api('POST', '/v1/open', {});
    expect(open.json.opened).toBe(true);
    expect(open.json.status.presentation).toEqual({ name: 'WorkVerse Teste Ação.pptx', slides: 5 });
    expect(open.json.status.index).toBe(1);
    expect(open.json.status.notes).toBe('Notas do orador 1');
    expect(open.json.status.title).toBe('Slide 1 Azul');

    const start = await api('POST', '/v1/start', { mode: 'window' });
    expect(start.status).toBe(200);
    expect(start.json.status.show).toMatchObject({ state: 'running', mode: 'window' });
    expect(realShowCount()).toBe(1);
    expect(realIndex()).toBe(1);

    const next = await api('POST', '/v1/next', {});
    expect(next.json.status.index).toBe(2);
    expect(realIndex()).toBe(2);
    expect(next.json.status.title).toBe('Slide 2 Verde');
    expect(next.json.status.notes).toBe('Notas do orador 2');

    await api('POST', '/v1/prev', {});
    expect(realIndex()).toBe(1);

    const go = await api('POST', '/v1/goto', { index: 4 });
    expect(go.json.status.index).toBe(4);
    expect(realIndex()).toBe(4);
    expect(go.json.status.title).toBe('Slide 4 Ciano');

    await api('POST', '/v1/last', {});
    expect(realIndex()).toBe(5);
    await api('POST', '/v1/first', {});
    expect(realIndex()).toBe(1);
    expect((await api('POST', '/v1/goto', { index: 9 })).status).toBe(400);
    expect(realIndex()).toBe(1);
  }, 120_000);

  it('tela preta/branca alterna e o ponteiro muda', async () => {
    const black = await api('POST', '/v1/blank', { kind: 'black' });
    expect(black.json.status.show.state).toBe('black');
    expect(Number(sh("$a=[System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application'); [int]$a.SlideShowWindows.Item(1).View.State"))).toBe(3);
    const back = await api('POST', '/v1/blank', { kind: 'black' });
    expect(back.json.status.show.state).toBe('running');
    const white = await api('POST', '/v1/blank', { kind: 'white' });
    expect(white.json.status.show.state).toBe('white');
    await api('POST', '/v1/blank', { kind: 'white' });

    const pen = await api('POST', '/v1/pointer', { mode: 'pen' });
    expect(pen.json.status.show.pointer).toBe('pen');
    const arrow = await api('POST', '/v1/pointer', { mode: 'arrow' });
    expect(arrow.json.status.show.pointer).toBe('arrow');
    const laser = await api('POST', '/v1/pointer', { mode: 'laser' });
    // Laser needs PowerPoint 2013+; either it works or the connector says so clearly.
    expect([200, 501]).toContain(laser.status);
    await api('POST', '/v1/pointer', { mode: 'arrow' });
  }, 60_000);

  it('exporta slides (PNG 1600) e miniaturas e confere os arquivos', async () => {
    const start = await api('POST', '/v1/export', { width: 1600, format: 'png' });
    expect(start.status).toBe(200);
    let prog = start.json;
    for (let i = 0; i < 200 && prog.state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 150));
      prog = (await api('GET', '/v1/export')).json;
    }
    expect(prog).toMatchObject({ state: 'done', ready: 5, total: 5 });
    for (let i = 1; i <= 5; i++) {
      const img = await api('GET', `/v1/slides/${i}/full`);
      expect(img.type).toBe('image/png');
      expect(img.bytes!.length).toBeGreaterThan(2000);
      expect(img.bytes!.subarray(1, 4).toString()).toBe('PNG');
      expect(img.bytes!.readUInt32BE(16)).toBe(1600); // IHDR width
    }
    // thumbnails are produced by themselves
    let thumbs = (await api('GET', '/v1/status')).json.thumbs;
    for (let i = 0; i < 100 && thumbs.ready < 5; i++) {
      await new Promise((r) => setTimeout(r, 150));
      thumbs = (await api('GET', '/v1/status')).json.thumbs;
    }
    expect(thumbs.ready).toBe(5);
    const t = await api('GET', '/v1/slides/3/thumb');
    expect(t.type).toBe('image/jpeg');
    expect(t.bytes!.length).toBeGreaterThan(500);
    expect(t.bytes![0]).toBe(0xff);
    // files really are on disk, inside the private folder
    const files = fs.readdirSync(path.join(dir, 'exports'));
    expect(files.filter((f) => f.startsWith('full-')).length).toBe(5);
  }, 120_000);

  it('encerra a apresentação sem fechar o arquivo', async () => {
    const end = await api('POST', '/v1/end', {});
    expect(end.json.status.show).toBeNull();
    expect(end.json.status.presentation.name).toBe('WorkVerse Teste Ação.pptx');
    expect(realShowCount()).toBe(0);
  }, 30_000);

  it('iniciar em tela cheia a partir do slide 3 e passar do último slide encerra o show', async () => {
    const start = await api('POST', '/v1/start', { mode: 'fullscreen', from: 3 });
    expect(start.json.status.show.mode).toBe('fullscreen');
    expect(realIndex()).toBe(3);
    await api('POST', '/v1/next', {});
    await api('POST', '/v1/next', {});
    expect(realIndex()).toBe(5);
    const past = await api('POST', '/v1/next', {});
    expect(past.status).toBe(200);
    expect(realShowCount()).toBe(0);
  }, 60_000);

  it('o arquivo não foi alterado nem salvo (aberto somente leitura)', () => {
    const now = fs.statSync(pptx);
    expect(now.mtimeMs).toBe(createdMtime);
    expect(now.size).toBe(createdSize);
  });
});
