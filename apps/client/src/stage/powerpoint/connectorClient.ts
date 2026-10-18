import {
  POWERPOINT_CONNECTOR_PORT,
  type BlankKind,
  type ConnectorErrorBody,
  type ExportFormat,
  type ExportProgress,
  type PointerMode,
  type PresentationStatus,
  type ShowMode,
} from '@workverse/shared';

/** Client of the local WorkVerse PowerPoint Connector (127.0.0.1). The token lives only in sessionStorage. */

const TOKEN_KEY = 'wv.ppt.token';
const URL_KEY = 'wv.ppt.url';

export const defaultConnectorUrl = () => `http://127.0.0.1:${POWERPOINT_CONNECTOR_PORT}`;

const store = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, v);
    } catch {
      /* private mode: stays in memory only */
    }
  },
};

export const savedToken = () => store.get(TOKEN_KEY);
export const saveToken = (t: string | null) => store.set(TOKEN_KEY, t);
export const savedUrl = () => store.get(URL_KEY) ?? defaultConnectorUrl();
export const saveUrl = (u: string) => store.set(URL_KEY, u);

export class ConnectorError extends Error {
  constructor(
    /** Server error code, or 'offline' when the connector could not be reached. */
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

const OFFLINE = 'Não encontrei o conector neste computador. Inicie o "Conector-PowerPoint.bat" e tente de novo.';

/** Only loopback addresses are accepted, whatever the person types. */
export function normalizeConnectorUrl(raw: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

async function request(base: string, method: string, path: string, token: string | null, body?: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(base + path, {
      method,
      mode: 'cors',
      cache: 'no-store',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ConnectorError('offline', OFFLINE);
  }
  if (!res.ok) {
    let code = 'internal';
    let message = 'Falha ao falar com o conector.';
    try {
      const b = (await res.json()) as ConnectorErrorBody;
      code = b.error.code;
      message = b.error.message;
    } catch {
      /* keep defaults */
    }
    throw new ConnectorError(code, message, res.status);
  }
  return res;
}

/** Exchanges the 6-digit code shown in the connector console for the long secret. */
export async function pairWithConnector(base: string, code: string): Promise<string> {
  const res = await request(base, 'POST', '/v1/pair', null, { code: code.replace(/\D/g, '') });
  return ((await res.json()) as { token: string }).token;
}

export class ConnectorClient {
  constructor(
    readonly base: string,
    private readonly token: string,
  ) {}

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await (await request(this.base, method, path, this.token, body)).json()) as T;
  }
  private async act(path: string, body: unknown = {}) {
    return (await this.json<{ status: PresentationStatus }>('POST', path, body)).status;
  }

  status = () => this.json<PresentationStatus>('GET', '/v1/status');
  open = () => this.json<{ opened: boolean; status: PresentationStatus }>('POST', '/v1/open', {});
  start = (mode: ShowMode, from?: number) => this.act('/v1/start', { mode, ...(from ? { from } : {}) });
  next = () => this.act('/v1/next');
  prev = () => this.act('/v1/prev');
  first = () => this.act('/v1/first');
  last = () => this.act('/v1/last');
  goto = (index: number) => this.act('/v1/goto', { index });
  blank = (kind: BlankKind) => this.act('/v1/blank', { kind });
  pointer = (mode: PointerMode) => this.act('/v1/pointer', { mode });
  end = () => this.act('/v1/end');
  refreshThumbs = () => this.json<{ ok: true }>('POST', '/v1/thumbs', {});
  startExport = (width: number, format: ExportFormat) => this.json<ExportProgress>('POST', '/v1/export', { width, format });
  exportProgress = () => this.json<ExportProgress>('GET', '/v1/export');

  async image(index: number, kind: 'thumb' | 'full'): Promise<Blob> {
    return (await request(this.base, 'GET', `/v1/slides/${index}/${kind}`, this.token)).blob();
  }
}
