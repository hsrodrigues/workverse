import type { AccountView, ApiErrorBody, ProfilePatch, ProfileView, ServerConfig } from '@workverse/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
    /** Campo do formulario a que o erro se refere (quando o servidor informa). */
    readonly field?: string,
  ) {
    super(message);
  }
}

/** Turns an API error into a user-facing Portuguese message (adds the wait time on rate limits). */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.retryAfterSeconds !== undefined) {
      const s = err.retryAfterSeconds;
      const wait = s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`;
      return `${err.message} Tente novamente em ${wait}.`;
    }
    return err.message;
  }
  return 'Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.';
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export async function request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.');
  }
  if (res.status === 204) return undefined as T;
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const e = (data as Partial<ApiErrorBody> | undefined)?.error;
    const retry = e?.retryAfterSeconds ?? (Number(res.headers.get('Retry-After')) || undefined);
    throw new ApiError(res.status, e?.code ?? 'unknown', e?.message ?? 'Algo deu errado. Tente de novo.', retry, (e as { field?: string } | undefined)?.field);
  }
  return data as T;
}

export const api = {
  config: () => request<ServerConfig>('GET', '/api/config'),
  me: () => request<{ account: AccountView }>('GET', '/api/me').then((r) => r.account),
  login: (email: string, password: string) =>
    request<{ account: AccountView }>('POST', '/api/login', { email, password }).then((r) => r.account),
  register: (email: string, password: string, displayName: string, inviteToken?: string) =>
    request<{ account: AccountView }>('POST', '/api/register', { email, password, displayName, ...(inviteToken ? { inviteToken } : {}) }).then((r) => r.account),
  logout: () => request<void>('POST', '/api/logout', {}),
  profile: () => request<{ profile: ProfileView }>('GET', '/api/profile').then((r) => r.profile),
  saveProfile: (patch: ProfilePatch) => request<{ profile: ProfileView }>('PATCH', '/api/profile', patch).then((r) => r.profile),
  changePassword: (current: string, next: string) => request<{ account: AccountView }>('POST', '/api/account/password', { current, next }).then((r) => r.account),
};
