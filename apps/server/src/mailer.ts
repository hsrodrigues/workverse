import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

/**
 * Envio de e-mail PLUGAVEL, sem dependencia nova. Hoje serve so a redefinicao de senha (docs/password-reset.md).
 *   MAIL_PROVIDER=resend  API HTTPS do Resend (RESEND_API_KEY, MAIL_FROM)
 *   MAIL_PROVIDER=smtp    SMTP minimo (SMTP_URL=smtps://usuario:senha@host:465 ou smtp://...:587 com STARTTLS, MAIL_FROM)
 *   MAIL_PROVIDER=log     so registra a mensagem no log do servidor (PADRAO EM DESENVOLVIMENTO; nunca em producao)
 *   MAIL_PROVIDER=off     desliga o recurso (PADRAO EM PRODUCAO quando nada esta configurado)
 */
export type MailProviderName = 'resend' | 'smtp' | 'log' | 'off';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  readonly provider: MailProviderName;
  /** false = recurso desligado (o servidor informa isso ao cliente e a tela manda falar com a staff). */
  readonly enabled: boolean;
  /** Por que esta desligado (para o log de boot). */
  readonly reason?: string;
  send(msg: MailMessage): Promise<void>;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal; redirect?: 'error' | 'manual' | 'follow' }) => Promise<{ ok: boolean; status: number }>;

export interface MailerOptions {
  fetch?: FetchLike;
  log?: (line: string) => void;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const RESEND_URL = 'https://api.resend.com/emails';

export class MailError extends Error {}

const clean = (v: string | undefined) => (v ?? '').trim();
/** Cabecalhos nunca podem carregar quebra de linha (injecao de cabecalho). */
const oneLine = (v: string) => v.replace(/[\r\n]+|\p{Zl}|\p{Zp}/gu, ' ').trim();
const EMAIL_ONLY = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/** Endereco puro de `MAIL_FROM` ("Nome <a@b.com>" ou "a@b.com"). */
export function fromAddress(from: string): string | null {
  const m = /<([^<>]+)>\s*$/.exec(from);
  const addr = (m ? m[1]! : from).trim();
  return EMAIL_ONLY.test(addr) ? addr : null;
}

function disabled(provider: MailProviderName, reason: string): Mailer {
  return { provider, enabled: false, reason, send: async () => { throw new MailError('envio de e-mail desligado'); } };
}

/** Mascara um token para log: nunca o valor inteiro. */
export const maskToken = (t: string) => `${t.slice(0, 4)}...(${t.length})`;

/** Escolhe e valida o provedor a partir do ambiente. Funcao pura (testavel). */
export function createMailer(env: NodeJS.ProcessEnv, production: boolean, opts: MailerOptions = {}): Mailer {
  const raw = clean(env.MAIL_PROVIDER).toLowerCase();
  const provider = (raw === '' ? (production ? 'off' : 'log') : raw) as MailProviderName;
  const log = opts.log ?? ((l) => console.log(l));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (provider === 'off') return disabled('off', raw === '' ? 'MAIL_PROVIDER nao configurado' : 'MAIL_PROVIDER=off');

  if (provider === 'log') {
    if (production) return disabled('log', 'MAIL_PROVIDER=log so existe em desenvolvimento (o link ficaria no log do servidor)');
    return {
      provider: 'log',
      enabled: true,
      async send(msg) {
        // Desenvolvimento: o corpo (com o link) aparece no log para a pessoa copiar. Nunca usado em producao.
        log(`[mail:log] para=${oneLine(msg.to)} assunto="${oneLine(msg.subject)}"\n${msg.text}`);
      },
    };
  }

  const from = clean(env.MAIL_FROM);
  if (provider !== 'resend' && provider !== 'smtp') return disabled('off', `MAIL_PROVIDER invalido: "${raw}" (use resend, smtp, log ou off)`);
  if (!fromAddress(from)) return disabled(provider, 'MAIL_FROM ausente ou invalido (ex.: WorkVerse <no-reply@seudominio.com>)');

  if (provider === 'resend') {
    const key = clean(env.RESEND_API_KEY);
    if (!key) return disabled('resend', 'RESEND_API_KEY ausente');
    const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
    return {
      provider: 'resend',
      enabled: true,
      async send(msg) {
        const body = JSON.stringify({ from: oneLine(from), to: [oneLine(msg.to)], subject: oneLine(msg.subject), text: msg.text, ...(msg.html ? { html: msg.html } : {}) });
        let res: { ok: boolean; status: number };
        try {
          res = await doFetch(RESEND_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body,
            signal: AbortSignal.timeout(timeoutMs),
            redirect: 'error',
          });
        } catch {
          throw new MailError('falha de rede ao chamar o Resend'); // sem a mensagem original: ela pode conter a URL/cabecalhos
        }
        if (!res.ok) throw new MailError(`Resend recusou o envio (HTTP ${res.status})`);
      },
    };
  }

  // smtp
  const url = clean(env.SMTP_URL);
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== 'smtps:' && parsed.protocol !== 'smtp:') throw new Error('protocolo');
  } catch {
    return disabled('smtp', 'SMTP_URL ausente ou invalida (ex.: smtps://usuario:senha@smtp.exemplo.com:465)');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const cfg: SmtpConfig = {
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port: Number(parsed.port) || (parsed.protocol === 'smtps:' ? 465 : 587),
    implicitTls: parsed.protocol === 'smtps:',
    user: decodeURIComponent(parsed.username),
    pass: decodeURIComponent(parsed.password),
    allowPlain: local,
    from,
    timeoutMs,
  };
  return { provider: 'smtp', enabled: true, send: (msg) => smtpSend(cfg, msg) };
}

// ---- SMTP minimo -----------------------------------------------------------------------------------------------

interface SmtpConfig {
  host: string;
  port: number;
  implicitTls: boolean;
  user: string;
  pass: string;
  /** Texto puro so para localhost (testes / relay local); o resto exige TLS. */
  allowPlain: boolean;
  from: string;
  timeoutMs: number;
}

class SmtpSession {
  private buf = '';
  private waiter: { resolve: (r: { code: number; lines: string[] }) => void; reject: (e: Error) => void } | null = null;
  private lines: string[] = [];
  private failure: Error | null = null;

  constructor(public socket: Socket | TLSSocket) {
    this.attach(socket);
  }

  private attach(s: Socket) {
    s.setEncoding('utf8');
    s.on('data', (chunk: string) => {
      this.buf += chunk;
      let i: number;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, '');
        this.buf = this.buf.slice(i + 1);
        this.lines.push(line);
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
          const reply = { code: Number(line.slice(0, 3)), lines: this.lines };
          this.lines = [];
          this.waiter?.resolve(reply);
          this.waiter = null;
        }
      }
    });
    const fail = (e: Error) => {
      this.failure = e;
      this.waiter?.reject(e);
      this.waiter = null;
    };
    s.on('error', (e) => fail(new MailError(`erro de conexao SMTP: ${(e as NodeJS.ErrnoException).code ?? 'desconhecido'}`)));
    s.on('close', () => fail(new MailError('conexao SMTP encerrada')));
  }

  /** Troca o socket (STARTTLS). */
  upgrade(s: TLSSocket) {
    this.socket = s;
    this.buf = '';
    this.attach(s);
  }

  reply(): Promise<{ code: number; lines: string[] }> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  async cmd(line: string, ok: number[]): Promise<string[]> {
    // O que sai do cliente nunca contem CR/LF alem do terminador: quem monta `line` passa por oneLine.
    this.socket.write(`${line}\r\n`);
    const r = await this.reply();
    if (!ok.includes(r.code)) throw new MailError(`SMTP respondeu ${r.code} a ${line.split(' ')[0]}`);
    return r.lines;
  }
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** Corpo MIME simples (texto, UTF-8, base64) com dot-stuffing. */
export function buildMime(from: string, msg: MailMessage, date = new Date()): string {
  const wrap = (s: string) => (s.match(/.{1,76}/g) ?? ['']).join('\r\n');
  const headers = [
    `From: ${oneLine(from)}`,
    `To: ${oneLine(msg.to)}`,
    `Subject: =?UTF-8?B?${b64(oneLine(msg.subject))}?=`,
    `Date: ${date.toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${wrap(b64(msg.text))}`;
}

async function smtpSend(cfg: SmtpConfig, msg: MailMessage): Promise<void> {
  const to = oneLine(msg.to);
  if (!EMAIL_ONLY.test(to)) throw new MailError('destinatario invalido');
  const sender = fromAddress(cfg.from)!;
  let live: Socket | undefined;
  const run = async () => {
    const socket: Socket | TLSSocket = cfg.implicitTls
      ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host, minVersion: 'TLSv1.2' })
      : netConnect({ host: cfg.host, port: cfg.port });
    live = socket;
    const s = new SmtpSession(socket);
    try {
      const greet = await s.reply();
      if (greet.code !== 220) throw new MailError(`SMTP recusou a conexao (${greet.code})`);
      let caps = await s.cmd('EHLO workverse', [250]);
      let secure = cfg.implicitTls;
      if (!secure && caps.some((l) => /STARTTLS/i.test(l))) {
        await s.cmd('STARTTLS', [220]);
        const up = tlsConnect({ socket: s.socket as Socket, servername: cfg.host, minVersion: 'TLSv1.2' });
        live = up;
        s.upgrade(up);
        caps = await s.cmd('EHLO workverse', [250]);
        secure = true;
      }
      if (!secure && !cfg.allowPlain) throw new MailError('o servidor SMTP nao oferece TLS; recusado para nao enviar credenciais em texto puro');
      if (cfg.user) {
        const mech = caps.join(' ').toUpperCase();
        if (mech.includes('PLAIN')) await s.cmd(`AUTH PLAIN ${b64(`\0${cfg.user}\0${cfg.pass}`)}`, [235]);
        else if (mech.includes('LOGIN')) {
          await s.cmd('AUTH LOGIN', [334]);
          await s.cmd(b64(cfg.user), [334]);
          await s.cmd(b64(cfg.pass), [235]);
        } else throw new MailError('o servidor SMTP nao oferece AUTH PLAIN/LOGIN');
      }
      await s.cmd(`MAIL FROM:<${sender}>`, [250]);
      await s.cmd(`RCPT TO:<${to}>`, [250, 251]);
      await s.cmd('DATA', [354]);
      const data = buildMime(cfg.from, msg).replace(/^\./gm, '..');
      await s.cmd(`${data}\r\n.`, [250]);
      s.socket.write('QUIT\r\n');
    } finally {
      s.socket.destroy();
    }
  };
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new MailError('tempo esgotado no SMTP')), cfg.timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    live?.destroy();
  }
}
