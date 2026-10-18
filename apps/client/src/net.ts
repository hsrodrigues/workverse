import type { AvatarConfig, ClientMessage, ServerMessage } from '@workverse/shared';
import { api, ApiError } from './api';

export type ConnStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'replaced' | 'unauthenticated' | 'kicked';
type SessionMsg = Extract<ServerMessage, { t: 'session' }>;
type Handler = (msg: ServerMessage) => void;

const FATAL_ON_CONNECT = new Set(['bad_name', 'name_taken']);
/** Close code the server uses after sending an `unauthorized` / `signed_out` error. */
const CLOSE_UNAUTHORIZED = 4001;

function wsUrl(): string {
  const env = (import.meta as { env?: Record<string, string> }).env?.VITE_WS_URL;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/**
 * WebSocket wrapper with automatic reconnection. Authentication is the httpOnly
 * session cookie, sent by the browser on the upgrade request. After a reconnect
 * it replays `hello` and rejoins the last room. If the server refuses the
 * upgrade (401, expired session) the status becomes `unauthenticated`.
 */
export class NetClient {
  status: ConnStatus = 'idle';
  latencyMs = 0;
  roomId: string | undefined;
  /** Motivo informado pelo servidor quando a staff encerrou a sessao (status `kicked`). */
  kickMessage = '';

  private ws: WebSocket | undefined;
  private handlers = new Set<Handler>();
  private statusHandlers = new Set<() => void>();
  private wantOpen = false;
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  /** Only used with ALLOW_DEV_LOGIN (name-only hello). */
  private devName: string | undefined;
  private avatar: AvatarConfig | undefined;
  private firstSession: { resolve: (s: SessionMsg) => void; reject: (e: Error) => void } | undefined;
  private hadSession = false;

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStatus(handler: () => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  /** Opens the WebSocket for the logged-in account. `devName`/`avatar` are honoured only in dev-login mode. */
  connect(devName?: string, avatar?: AvatarConfig): Promise<SessionMsg> {
    this.disconnect();
    this.devName = devName;
    this.avatar = avatar;
    this.wantOpen = true;
    this.retry = 0;
    this.hadSession = false;
    this.roomId = undefined;
    return new Promise((resolve, reject) => {
      this.firstSession = { resolve, reject };
      this.open();
    });
  }

  disconnect() {
    this.wantOpen = false;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
    this.firstSession?.reject(new Error('Conexão cancelada.'));
    this.firstSession = undefined;
    this.setStatus('idle');
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setStatus(s: ConnStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statusHandlers.forEach((h) => h());
  }

  private unauthenticated() {
    this.wantOpen = false;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
    this.firstSession?.reject(new Error('Sua sessão expirou. Entre novamente.'));
    this.firstSession = undefined;
    this.setStatus('unauthenticated');
  }

  private open() {
    this.setStatus(this.hadSession ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      opened = true;
      this.send({ t: 'hello', name: this.devName, avatar: this.avatar });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.receive(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      if (!this.wantOpen) return;
      if (ev.code === CLOSE_UNAUTHORIZED) return this.unauthenticated();
      this.setStatus('reconnecting');
      const delay = Math.min(5000, 400 * 2 ** this.retry) + Math.random() * 300;
      this.retry++;
      const schedule = () => {
        if (this.ws !== ws || !this.wantOpen) return;
        this.reconnectTimer = setTimeout(() => this.open(), delay);
      };
      if (opened) return schedule();
      // The upgrade was refused. Browsers hide the HTTP status of a failed WebSocket handshake,
      // so ask the API whether the session is still valid (401 means go back to the login).
      api.me().then(schedule, (err) => {
        if (this.ws !== ws || !this.wantOpen) return;
        if (err instanceof ApiError && err.status === 401) this.unauthenticated();
        else schedule();
      });
    };
    ws.onerror = () => ws.close();
  }

  private receive(msg: ServerMessage) {
    if (msg.t === 'session') {
      this.retry = 0;
      this.setStatus('online');
      if (this.hadSession && this.roomId) this.send({ t: 'join', roomId: this.roomId });
      this.hadSession = true;
      this.startPing();
      this.firstSession?.resolve(msg);
      this.firstSession = undefined;
    } else if (msg.t === 'room') {
      this.roomId = msg.room.def.id;
    } else if (msg.t === 'pong') {
      this.latencyMs = Math.max(0, Date.now() - msg.ts);
      this.statusHandlers.forEach((h) => h());
      return;
    } else if (msg.t === 'error') {
      if (msg.code === 'unauthorized' || msg.code === 'signed_out') {
        this.unauthenticated();
      } else if (this.firstSession && FATAL_ON_CONNECT.has(msg.code)) {
        const first = this.firstSession;
        this.firstSession = undefined;
        this.disconnect();
        first.reject(new Error(msg.message));
      } else if (msg.code === 'kicked') {
        this.kickMessage = msg.message;
        this.wantOpen = false;
        this.setStatus('kicked');
      } else if (msg.code === 'replaced') {
        this.wantOpen = false;
        this.setStatus('replaced');
      }
    }
    for (const h of [...this.handlers]) {
      // um ouvinte quebrado (ex.: cena antiga ja destruida) nao pode impedir os outros de receber a mensagem
      try {
        h(msg);
      } catch (err) {
        console.error('[net] ouvinte falhou', err);
      }
    }
  }

  private startPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: Date.now() }), 5000);
    this.send({ t: 'ping', ts: Date.now() });
  }
}

export const net = new NetClient();
