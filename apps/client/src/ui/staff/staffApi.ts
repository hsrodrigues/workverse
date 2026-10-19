import type { AuditRecord, StaffAccountDetail, StaffAccountRow, StaffLevel, StaffMemberRow } from '@workverse/shared';
import { ApiError, request } from '../../api';

/** Chamadas HTTP do painel de staff (/api/staff/*). O servidor valida tudo de novo; aqui so montamos as requisicoes. */

export interface OrgChoice {
  id: string;
  name: string;
  teams: { id: string; name: string; color: string }[];
}

export interface AuditFilters {
  actor?: string;
  target?: string;
  action?: string;
  /** Inicio e fim em ms desde 1970. */
  from?: number;
  to?: number;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const staffApi = {
  orgs: () => request<{ orgs: OrgChoice[] }>('GET', '/api/staff/orgs').then((r) => r.orgs),
  accounts: (q: string, filter: 'all' | 'staff' | 'online' | 'blocked') =>
    request<{ total: number; accounts: StaffAccountRow[] }>('GET', `/api/staff/accounts${qs({ q, filter })}`),
  account: (id: string) => request<{ account: StaffAccountDetail }>('GET', `/api/staff/accounts/${encodeURIComponent(id)}`).then((r) => r.account),
  create: (body: { email: string; displayName: string; password?: string; orgId?: string; teamId?: string; role?: string; title?: string }) =>
    request<{ account: StaffAccountRow; provisionalPassword: string }>('POST', '/api/staff/accounts', body),
  setProfile: (id: string, body: { orgId: string; teamId?: string; title?: string | null }) =>
    request<{ orgId: string; teamId: string | null; title: string | null }>('PATCH', `/api/staff/accounts/${encodeURIComponent(id)}/profile`, body),
  createDept: (orgId: string, name: string, color: string) => request<{ dept: { id: string; name: string; color: string } }>('POST', `/api/staff/orgs/${encodeURIComponent(orgId)}/depts`, { name, color }),
  updateDept: (orgId: string, teamId: string, body: { name?: string; color?: string }) =>
    request<{ dept: { id: string; name: string; color: string } }>('PATCH', `/api/staff/orgs/${encodeURIComponent(orgId)}/depts/${encodeURIComponent(teamId)}`, body),
  resetPassword: (id: string, password?: string) =>
    request<{ provisionalPassword: string }>('POST', `/api/staff/accounts/${encodeURIComponent(id)}/reset-password`, password ? { password } : {}),
  setDisabled: (id: string, disabled: boolean, reason?: string) =>
    request<{ account: StaffAccountRow }>('PATCH', `/api/staff/accounts/${encodeURIComponent(id)}`, { disabled, ...(reason ? { reason } : {}) }),
  ban: (id: string, minutes: number | null, reason: string) =>
    request<{ account: StaffAccountRow }>('POST', `/api/staff/accounts/${encodeURIComponent(id)}/ban`, { minutes, reason }),
  unban: (id: string) => request<{ account: StaffAccountRow }>('POST', `/api/staff/accounts/${encodeURIComponent(id)}/unban`, {}),
  team: () => request<{ staff: StaffMemberRow[] }>('GET', '/api/staff/team').then((r) => r.staff),
  addStaff: (identifier: string, level: StaffLevel) => request<{ member: StaffMemberRow }>('POST', '/api/staff/team', { identifier, level }),
  setLevel: (id: string, level: StaffLevel) => request<{ member: StaffMemberRow }>('PATCH', `/api/staff/team/${encodeURIComponent(id)}`, { level }),
  removeStaff: (id: string) => request<{ ok: true }>('DELETE', `/api/staff/team/${encodeURIComponent(id)}`),
  audit: (f: AuditFilters) => request<{ records: AuditRecord[] }>('GET', `/api/staff/audit${qs({ ...f, limit: 300 })}`).then((r) => r.records),
  announcements: () => request<{ records: AuditRecord[] }>('GET', '/api/staff/announcements').then((r) => r.records),
  /** Baixa o CSV da auditoria (com os mesmos filtros) como arquivo. */
  async downloadAudit(f: AuditFilters): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`/api/staff/audit.csv${qs({ ...f })}`, { credentials: 'same-origin' });
    } catch {
      throw new ApiError(0, 'network', 'Não foi possível falar com o servidor.');
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => undefined)) as { error?: { code?: string; message?: string } } | undefined;
      throw new ApiError(res.status, data?.error?.code ?? 'unknown', data?.error?.message ?? 'Não foi possível exportar.');
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `auditoria-staff-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};
