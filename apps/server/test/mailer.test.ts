import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMime, createMailer, fromAddress, maskToken, type FetchLike } from '../src/mailer';

const msg = { to: 'ana@example.com', subject: 'Olá mundo', text: 'linha 1\n.ponto no inicio\nlinha 3' };

describe('createMailer: escolha do provedor', () => {
  it('padrao: log em desenvolvimento, desligado em producao', () => {
    expect(createMailer({}, false).provider).toBe('log');
    expect(createMailer({}, false).enabled).toBe(true);
    const prod = createMailer({}, true);
    expect(prod.enabled).toBe(false);
    expect(prod.reason).toMatch(/MAIL_PROVIDER/);
  });

  it('off desliga e send recusa', async () => {
    const m = createMailer({ MAIL_PROVIDER: 'off' }, false);
    expect(m.enabled).toBe(false);
    await expect(m.send(msg)).rejects.toThrow();
  });

  it('log em producao e recusado (o link ficaria no log)', () => {
    const m = createMailer({ MAIL_PROVIDER: 'log' }, true);
    expect(m.enabled).toBe(false);
  });

  it('provedor log escreve o corpo no log em desenvolvimento', async () => {
    const lines: string[] = [];
    const m = createMailer({ MAIL_PROVIDER: 'log' }, false, { log: (l) => lines.push(l) });
    await m.send(msg);
    expect(lines.join('\n')).toContain('ana@example.com');
    expect(lines.join('\n')).toContain('linha 1');
  });

  it('resend/smtp sem configuracao completa ficam desligados com motivo', () => {
    expect(createMailer({ MAIL_PROVIDER: 'resend' }, true).enabled).toBe(false);
    expect(createMailer({ MAIL_PROVIDER: 'resend', MAIL_FROM: 'a@b.com' }, true).reason).toMatch(/RESEND_API_KEY/);
    expect(createMailer({ MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' }, true).reason).toMatch(/MAIL_FROM/);
    expect(createMailer({ MAIL_PROVIDER: 'smtp', MAIL_FROM: 'a@b.com' }, true).reason).toMatch(/SMTP_URL/);
    expect(createMailer({ MAIL_PROVIDER: 'smtp', MAIL_FROM: 'a@b.com', SMTP_URL: 'http://x' }, true).enabled).toBe(false);
    expect(createMailer({ MAIL_PROVIDER: 'foo' }, true).enabled).toBe(false);
  });

  it('fromAddress aceita "Nome <a@b.com>" e puro, recusa lixo', () => {
    expect(fromAddress('WorkVerse <no-reply@x.com>')).toBe('no-reply@x.com');
    expect(fromAddress('no-reply@x.com')).toBe('no-reply@x.com');
    expect(fromAddress('sem arroba')).toBeNull();
  });

  it('maskToken nunca devolve o token inteiro', () => {
    const t = 'abcdefghijklmnopqrstuvwxyz0123456789abcdefg';
    expect(maskToken(t)).not.toContain(t.slice(5));
  });
});

describe('provedor resend (fetch injetado)', () => {
  const env = { MAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_secret_key', MAIL_FROM: 'WorkVerse <no-reply@x.com>' };

  it('chama a API HTTPS com Bearer, JSON e sem seguir redirecionamento', async () => {
    const calls: Array<Parameters<FetchLike>> = [];
    const fetchFn: FetchLike = async (...a) => {
      calls.push(a);
      return { ok: true, status: 200 };
    };
    const m = createMailer(env, true, { fetch: fetchFn });
    expect(m.enabled).toBe(true);
    await m.send(msg);
    const [url, init] = calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer re_secret_key');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeDefined();
    expect(JSON.parse(init.body)).toMatchObject({ from: 'WorkVerse <no-reply@x.com>', to: ['ana@example.com'], subject: 'Olá mundo' });
  });

  it('erro HTTP vira MailError sem vazar a chave; falha de rede tambem', async () => {
    const bad = createMailer(env, true, { fetch: async () => ({ ok: false, status: 422 }) });
    const err1 = await bad.send(msg).catch((e: Error) => e);
    expect((err1 as Error).message).toContain('422');
    expect((err1 as Error).message).not.toContain('re_secret_key');
    const net = createMailer(env, true, {
      fetch: async () => {
        throw new Error('connect ECONNREFUSED Bearer re_secret_key');
      },
    });
    const err2 = await net.send(msg).catch((e: Error) => e);
    expect((err2 as Error).message).not.toContain('re_secret_key');
  });

  it('cabecalhos nao aceitam quebra de linha (assunto/destinatario)', async () => {
    let body = '';
    const m = createMailer(env, true, {
      fetch: async (_u, init) => {
        body = init.body;
        return { ok: true, status: 200 };
      },
    });
    await m.send({ to: 'a@b.com\r\nBcc: x@y.com', subject: 'oi\nBcc: x@y.com', text: 't' });
    const parsed = JSON.parse(body) as { to: string[]; subject: string };
    expect(parsed.to[0]).not.toMatch(/[\r\n]/);
    expect(parsed.subject).not.toMatch(/[\r\n]/);
  });
});

describe('provedor smtp (servidor falso em localhost)', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  function fakeSmtp(opts: { authOk?: boolean } = {}): Promise<{ port: number; transcript: string[] }> {
    const transcript: string[] = [];
    return new Promise((resolve) => {
      server = createServer((sock) => {
        sock.setEncoding('utf8');
        sock.on('error', () => undefined);
        let inData = false;
        let buf = '';
        sock.write('220 fake ESMTP\r\n');
        sock.on('data', (chunk: string) => {
          buf += chunk;
          let i: number;
          while ((i = buf.indexOf('\r\n')) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 2);
            transcript.push(line);
            if (inData) {
              if (line === '.') {
                inData = false;
                sock.write('250 queued\r\n');
              }
              continue;
            }
            if (line.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
            else if (line.startsWith('AUTH PLAIN')) sock.write(opts.authOk === false ? '535 no\r\n' : '235 ok\r\n');
            else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) sock.write('250 ok\r\n');
            else if (line === 'DATA') {
              inData = true;
              sock.write('354 go\r\n');
            } else if (line === 'QUIT') sock.end('221 bye\r\n');
            else sock.write('500 ?\r\n');
          }
        });
      });
      server.listen(0, '127.0.0.1', () => resolve({ port: (server!.address() as { port: number }).port, transcript }));
    });
  }

  it('entrega a mensagem com AUTH PLAIN e dot-stuffing', async () => {
    const { port, transcript } = await fakeSmtp();
    const m = createMailer({ MAIL_PROVIDER: 'smtp', SMTP_URL: `smtp://user:p%40ss@127.0.0.1:${port}`, MAIL_FROM: 'WorkVerse <no-reply@x.com>' }, true);
    expect(m.enabled).toBe(true);
    await m.send(msg);
    const text = transcript.join('\n');
    expect(text).toContain('MAIL FROM:<no-reply@x.com>');
    expect(text).toContain('RCPT TO:<ana@example.com>');
    const auth = transcript.find((l) => l.startsWith('AUTH PLAIN'))!;
    expect(Buffer.from(auth.slice(11), 'base64').toString()).toBe('\0user\0p@ss');
    expect(transcript).toContain('.');
  });

  it('AUTH recusado vira erro sem a senha', async () => {
    const { port } = await fakeSmtp({ authOk: false });
    const m = createMailer({ MAIL_PROVIDER: 'smtp', SMTP_URL: `smtp://user:topsecret@127.0.0.1:${port}`, MAIL_FROM: 'a@x.com' }, true);
    const err = (await m.send(msg).catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/535/);
    expect(err.message).not.toContain('topsecret');
  });

  it('servidor que nao responde estoura o tempo', async () => {
    server = createServer(() => undefined);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    const m = createMailer({ MAIL_PROVIDER: 'smtp', SMTP_URL: `smtp://u:p@127.0.0.1:${port}`, MAIL_FROM: 'a@x.com' }, true, { timeoutMs: 150 });
    await expect(m.send(msg)).rejects.toThrow(/tempo esgotado/);
  });

  it('buildMime codifica assunto e corpo em base64 UTF-8', () => {
    const mime = buildMime('a@x.com', msg, new Date(0));
    expect(mime).toContain('Subject: =?UTF-8?B?');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
    expect(mime).not.toContain('Olá');
  });
});
