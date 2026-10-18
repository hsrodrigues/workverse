import { useCallback, useEffect, useState } from 'react';
import { BAN_MAX_MINUTES, CREATE_ROLE_MAX, MAX_STAFF_REASON, ROLES, ROLE_RANK, STAFF_RANK, type StaffAccountDetail, type StaffAccountRow } from '@workverse/shared';
import { Chip, Field, SecretBox, fmtDateTime, usePanel } from './staffUi';
import { Sheet } from './OnlineTab';
import { staffApi, type OrgChoice } from './staffApi';

const ROLE_LABEL: Record<string, string> = { owner: 'Dono', admin: 'Administrador', member: 'Membro', guest: 'Convidado' };
const FILTERS = [
  ['all', 'Todas'],
  ['online', 'Online'],
  ['staff', 'Staff'],
  ['blocked', 'Bloqueadas'],
] as const;
type Filter = (typeof FILTERS)[number][0];
const BAN_CHOICES: { label: string; minutes: number | null }[] = [
  { label: '1 hora', minutes: 60 },
  { label: '1 dia', minutes: 1440 },
  { label: '7 dias', minutes: 7 * 1440 },
  { label: '30 dias', minutes: 30 * 1440 },
  { label: 'Permanente', minutes: null },
];

export function AccountsTab() {
  const p = usePanel();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<StaffAccountRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ title: string; password: string } | null>(null);
  const { run } = p;

  const load = useCallback(async () => {
    const r = await run(() => staffApi.accounts(q, filter));
    if (r) {
      setRows(r.accounts);
      setTotal(r.total);
    }
    setLoading(false);
  }, [run, q, filter]);

  useEffect(() => {
    const id = setTimeout(() => void load(), 220);
    return () => clearTimeout(id);
  }, [load]);

  return (
    <div data-testid="staff-tab-accounts">
      {secret && <SecretBox title={secret.title} password={secret.password} onClose={() => setSecret(null)} />}

      <div className="sf-toolbar">
        <input className="sf-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome" aria-label="Buscar contas" data-testid="staff-accounts-search" />
        <select className="sf-input sf-select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filtrar contas" data-testid="staff-accounts-filter">
          {FILTERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button type="button" className={`mini gold ${creating ? 'on' : ''}`} disabled={!p.can('accounts.create')} onClick={() => setCreating(!creating)} aria-expanded={creating} data-testid="staff-account-new">
          + Nova conta
        </button>
      </div>

      {creating && (
        <CreateForm
          onCreated={(account, password) => {
            setSecret({ title: `Conta criada: ${account.displayName}`, password });
            setCreating(false);
            void load();
          }}
        />
      )}

      <div className="sf-count">
        <strong>{total}</strong> conta{total === 1 ? '' : 's'}
        {total > rows.length && ` (mostrando ${rows.length}; refine a busca)`}
      </div>
      <div className="sf-split sf-split-accounts">
        <ul className="sf-list sf-col sf-col-list" data-testid="staff-accounts-list">
          {rows.map((a) => (
            <li key={a.id}>
              <button type="button" className={`sf-row ${a.id === selId ? 'on' : ''}`} onClick={() => setSelId(a.id === selId ? null : a.id)} aria-pressed={a.id === selId} data-testid={`staff-account-${a.displayName}`}>
                <span className="sf-row-main">
                  <b>{a.displayName}</b>
                  {a.staff && <Chip tone="gold">{a.staff}</Chip>}
                  {a.online && <Chip tone="ok">online</Chip>}
                  {a.banned && <Chip tone="bad">banida</Chip>}
                  {a.disabled && <Chip tone="bad">desativada</Chip>}
                  {a.mustChangePassword && <Chip tone="warn">senha provisória</Chip>}
                </span>
                <span className="sf-row-sub">
                  {a.email} · {a.orgName ?? 'sem organização'}
                  {a.role ? ` (${ROLE_LABEL[a.role] ?? a.role})` : ''} · login: {fmtDateTime(a.lastLoginAt)}
                </span>
              </button>
            </li>
          ))}
          {rows.length === 0 && <li className="sf-empty">{loading ? 'Carregando…' : 'Nenhuma conta encontrada.'}</li>}
        </ul>
        <div className="sf-col sf-col-detail">
          {selId ? (
            <AccountDetail
              key={selId}
              id={selId}
              onChanged={() => void load()}
              onSecret={(title, password) => setSecret({ title, password })}
            />
          ) : (
            <p className="sf-empty sf-pick">Escolha uma conta para ver a ficha e as ações.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated(account: StaffAccountRow, password: string): void }) {
  const p = usePanel();
  const [orgs, setOrgs] = useState<OrgChoice[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [orgId, setOrgId] = useState('default');
  const [teamId, setTeamId] = useState('');
  const [role, setRole] = useState('member');
  const [custom, setCustom] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const { run } = p;

  useEffect(() => {
    void run(() => staffApi.orgs()).then((o) => o && setOrgs(o));
  }, [run]);
  const org = orgs.find((o) => o.id === orgId);
  useEffect(() => {
    setTeamId(org?.teams[0]?.id ?? '');
  }, [org]);

  const maxRank = ROLE_RANK[CREATE_ROLE_MAX[p.level]];
  const roles = ROLES.filter((r) => ROLE_RANK[r] <= maxRank);

  const submit = async () => {
    setBusy(true);
    const r = await run(() => staffApi.create({ email: email.trim(), displayName: name.trim(), ...(custom && password ? { password } : {}), orgId, ...(teamId ? { teamId } : {}), role }));
    setBusy(false);
    if (r) onCreated(r.account, r.provisionalPassword);
  };

  return (
    <form
      className="sf-card"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      data-testid="staff-create-form"
    >
      <h3 className="sf-card-title">Nova conta</h3>
      <div className="sf-grid2">
        <Field label="E-mail">
          <input className="sf-input" type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required data-testid="staff-create-email" />
        </Field>
        <Field label="Nome de exibição" hint="2 a 16 letras, números, espaço, _ ou -">
          <input className="sf-input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} autoComplete="off" required data-testid="staff-create-name" />
        </Field>
        <Field label="Organização">
          <select className="sf-input sf-select" value={orgId} onChange={(e) => setOrgId(e.target.value)} data-testid="staff-create-org">
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Equipe">
          <select className="sf-input sf-select" value={teamId} onChange={(e) => setTeamId(e.target.value)} data-testid="staff-create-team">
            {org?.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            {!org?.teams.length && <option value="">(sem equipe)</option>}
          </select>
        </Field>
        <Field label="Papel na organização" hint={p.level === 'admin' ? undefined : 'Seu nível atribui até “Membro”.'}>
          <select className="sf-input sf-select" value={role} onChange={(e) => setRole(e.target.value)} data-testid="staff-create-role">
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <label className="sf-check">
            <input type="radio" name="pwmode" checked={!custom} onChange={() => setCustom(false)} data-testid="staff-create-gen" /> Gerar senha provisória forte
          </label>
          <label className="sf-check">
            <input type="radio" name="pwmode" checked={custom} onChange={() => setCustom(true)} /> Definir a senha provisória
          </label>
          {custom && <input className="sf-input" type="text" value={password} maxLength={128} onChange={(e) => setPassword(e.target.value)} placeholder="mínimo 10 caracteres" aria-label="Senha provisória" autoComplete="off" data-testid="staff-create-password" />}
        </div>
      </div>
      <p className="sf-hint">A pessoa terá de trocar a senha no primeiro login. Ela não se cadastra sozinha: só entra com a conta criada aqui.</p>
      <button className="mini gold" disabled={busy || !email.trim() || !name.trim() || (custom && password.length < 10)} data-testid="staff-create-submit">
        {busy ? 'Criando…' : 'Criar conta'}
      </button>
    </form>
  );
}

function AccountDetail({ id, onChanged, onSecret }: { id: string; onChanged(): void; onSecret(title: string, password: string): void }) {
  const p = usePanel();
  const [d, setD] = useState<StaffAccountDetail | null>(null);
  const [ban, setBan] = useState(false);
  const [banMinutes, setBanMinutes] = useState<number | null>(1440);
  const [banReason, setBanReason] = useState('');
  const { run } = p;

  const load = useCallback(async () => {
    const r = await run(() => staffApi.account(id));
    if (r) setD(r);
  }, [run, id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!d) return <p className="sf-empty">Carregando ficha…</p>;
  const self = d.id === p.selfId;
  const banMax = BAN_MAX_MINUTES[p.level];
  const banChoices = BAN_CHOICES.filter((c) => (banMax === null ? true : c.minutes !== null && c.minutes <= banMax));
  const done = () => {
    void load();
    onChanged();
  };

  const reset = async () => {
    const ok = await p.confirm({
      title: `Redefinir a senha de ${d.displayName}?`,
      message: <>Uma nova senha provisória será gerada e <b>todas as sessões</b> da conta serão encerradas. A pessoa terá de trocar a senha ao entrar.</>,
      confirmLabel: 'Redefinir senha',
      danger: true,
    });
    if (!ok) return;
    const r = await run(() => staffApi.resetPassword(d.id));
    if (r) {
      onSecret(`Nova senha de ${d.displayName}`, r.provisionalPassword);
      done();
    }
  };

  const toggleDisabled = async () => {
    const disabling = !d.disabled;
    const ok = await p.confirm({
      title: disabling ? `Desativar ${d.displayName}?` : `Reativar ${d.displayName}?`,
      message: disabling ? <>A conta não poderá entrar e as sessões abertas caem agora. Dá para reativar depois.</> : <>A conta volta a poder entrar com a senha atual.</>,
      confirmLabel: disabling ? 'Desativar' : 'Reativar',
      danger: disabling,
    });
    if (!ok) return;
    if (await run(() => staffApi.setDisabled(d.id, disabling), disabling ? 'Conta desativada.' : 'Conta reativada.')) done();
  };

  const doBan = async () => {
    if (!banReason.trim()) return p.notify('err', 'Informe o motivo do banimento.');
    const label = banMinutes === null ? 'permanentemente' : `por ${banChoices.find((c) => c.minutes === banMinutes)?.label ?? banMinutes + ' min'}`;
    const ok = await p.confirm({ title: `Banir ${d.displayName}?`, message: <>A conta será banida <b>{label}</b> e a sessão cai agora. Motivo: “{banReason.trim()}”.</>, confirmLabel: 'Banir conta', danger: true });
    if (!ok) return;
    if (await run(() => staffApi.ban(d.id, banMinutes, banReason.trim()), 'Conta banida.')) {
      setBan(false);
      setBanReason('');
      done();
    }
  };

  const unban = async () => {
    if (await run(() => staffApi.unban(d.id), 'Banimento removido.')) done();
  };

  const ranked = !!d.staff && !self && STAFF_RANK[d.staff] >= STAFF_RANK[p.level];
  const blocked = self || ranked;

  return (
    <div className="sf-card" data-testid="staff-account-detail">
      <Sheet d={d} onClose={() => undefined} embedded />
      <div className="sf-group" role="group" aria-label="Ações sobre a conta">
        <button type="button" className="mini" disabled={!p.can('accounts.reset') || blocked || d.dev} onClick={() => void reset()} data-testid="staff-account-reset">
          Redefinir senha
        </button>
        <button type="button" className={`mini ${d.disabled ? 'gold' : 'danger'}`} disabled={!p.can('accounts.disable') || blocked} onClick={() => void toggleDisabled()} data-testid="staff-account-toggle">
          {d.disabled ? 'Reativar conta' : 'Desativar conta'}
        </button>
        {d.banned ? (
          <button type="button" className="mini gold" disabled={!p.can('unban') || blocked} onClick={() => void unban()} data-testid="staff-account-unban">
            Remover banimento
          </button>
        ) : (
          <button type="button" className={`mini danger ${ban ? 'on' : ''}`} disabled={!p.can('ban') || blocked || banChoices.length === 0} onClick={() => setBan(!ban)} aria-expanded={ban} data-testid="staff-account-ban-open">
            Banir…
          </button>
        )}
      </div>
      {blocked && <p className="sf-hint">{self ? 'Você não pode agir na própria conta (use “Alterar senha” no menu).' : 'Staff de nível igual ou maior não pode ser alterada por aqui.'}</p>}
      {ban && (
        <div className="sf-sub">
          <Field label="Duração">
            <select className="sf-input sf-select" value={banMinutes === null ? 'perm' : String(banMinutes)} onChange={(e) => setBanMinutes(e.target.value === 'perm' ? null : Number(e.target.value))}>
              {banChoices.map((c) => (
                <option key={c.label} value={c.minutes === null ? 'perm' : String(c.minutes)}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Motivo (obrigatório)">
            <input className="sf-input" value={banReason} maxLength={MAX_STAFF_REASON} onChange={(e) => setBanReason(e.target.value)} data-testid="staff-account-ban-reason" />
          </Field>
          <button type="button" className="mini danger" onClick={() => void doBan()} data-testid="staff-account-ban-confirm">
            Confirmar banimento
          </button>
        </div>
      )}
    </div>
  );
}
