import { useEffect, useMemo, useState } from 'react';
import { MAX_STAFF_REASON, MUTE_MAX_MINUTES, STATUS_LABELS, STAFF_RANK, BAN_MAX_MINUTES, type OnlineEntry, type PresenceStatus, type StaffAccountDetail } from '@workverse/shared';
import { net } from '../../net';
import { useWorld } from '../../worldStore';
import { StatusDot } from '../Social';
import { Chip, Field, fmtDateTime, usePanel } from './staffUi';
import { staffApi } from './staffApi';

const MUTE_CHOICES = [5, 15, 30, 60, 240, 1440, 10080];
const BAN_CHOICES: { label: string; minutes: number | null }[] = [
  { label: '1 hora', minutes: 60 },
  { label: '1 dia', minutes: 1440 },
  { label: '7 dias', minutes: 7 * 1440 },
  { label: '30 dias', minutes: 30 * 1440 },
  { label: 'Permanente', minutes: null },
];
const minutesLabel = (m: number) => (m >= 1440 ? `${m / 1440} dia${m >= 2880 ? 's' : ''}` : m >= 60 ? `${m / 60} h` : `${m} min`);

export function OnlineTab() {
  const w = useWorld();
  const p = usePanel();
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState<string | null>(null);

  const list = useMemo(() => {
    const n = q.normalize('NFKC').trim().toLowerCase();
    return w.staffOnline
      .filter((e) => !n || e.name.toLowerCase().includes(n) || e.roomName.toLowerCase().includes(n) || e.orgName.toLowerCase().includes(n))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [w.staffOnline, q]);

  const byOrg = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of w.staffOnline) m.set(e.orgName, (m.get(e.orgName) ?? 0) + 1);
    return [...m.entries()];
  }, [w.staffOnline]);

  const sel = w.staffOnline.find((e) => e.id === selId) ?? null;
  useEffect(() => {
    if (selId && !sel) setSelId(null);
  }, [selId, sel]);

  return (
    <div className="sf-split" data-testid="staff-tab-online">
      <section className="sf-col sf-col-list" aria-label="Pessoas online">
        <div className="sf-count" data-testid="staff-online-count">
          <strong>{w.staffOnline.length}</strong> online
          {byOrg.length > 1 && (
            <span className="sf-count-orgs">
              {byOrg.map(([org, n]) => (
                <Chip key={org}>
                  {org}: {n}
                </Chip>
              ))}
            </span>
          )}
        </div>
        <input className="sf-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, sala ou organização" aria-label="Buscar pessoas online" data-testid="staff-online-search" />
        <ul className="sf-list" data-testid="staff-online">
          {list.map((e) => (
            <li key={e.id}>
              <button type="button" className={`sf-row ${e.id === selId ? 'on' : ''}`} onClick={() => setSelId(e.id === selId ? null : e.id)} aria-pressed={e.id === selId} data-testid={`staff-player-${e.name}`}>
                <span className="sf-row-main">
                  <StatusDot status={(e.status as PresenceStatus) in STATUS_LABELS ? (e.status as PresenceStatus) : 'available'} />
                  <b>{e.name}</b>
                  {e.staff && <Chip tone="gold">STAFF</Chip>}
                  {e.muted && <Chip tone="bad">silenciado</Chip>}
                  {e.invisible && <Chip>invisível</Chip>}
                  {e.id === w.youId && <em> (você)</em>}
                </span>
                <span className="sf-row-sub">
                  {e.roomName} · {e.orgName} · {STATUS_LABELS[e.status as PresenceStatus] ?? e.status}
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="sf-empty">{w.staffOnline.length === 0 ? 'Ninguém online.' : 'Nada encontrado.'}</li>}
        </ul>
      </section>

      <section className="sf-col sf-col-detail" aria-label="Ações sobre a pessoa" aria-live="polite">
        {sel ? <PlayerActions key={sel.id} e={sel} /> : <p className="sf-empty sf-pick">Escolha uma pessoa da lista para ver as ações.</p>}
      </section>
    </div>
  );
}

function PlayerActions({ e }: { e: OnlineEntry }) {
  const w = useWorld();
  const p = usePanel();
  const self = e.id === w.youId;
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(15);
  const [banMinutes, setBanMinutes] = useState<number | null>(1440);
  const [banReason, setBanReason] = useState('');
  const [mode, setMode] = useState<null | 'ban' | 'item' | 'msg'>(null);
  const [itemKey, setItemKey] = useState('');
  const [msg, setMsg] = useState('');
  const [sheet, setSheet] = useState<StaffAccountDetail | null>(null);

  const ranked = !!e.staff && (e.staff === p.level || STAFF_RANK[e.staff] >= STAFF_RANK[p.level]);
  const reasonOrUndef = reason.trim() || undefined;
  const muteMax = MUTE_MAX_MINUTES[p.level];
  const banMax = BAN_MAX_MINUTES[p.level];
  const banChoices = BAN_CHOICES.filter((c) => (banMax === null ? true : c.minutes !== null && c.minutes <= banMax));
  const refresh = () => setTimeout(() => net.send({ t: 'staff_list' }), 300);
  const act = (msgOut: Parameters<typeof p.cmd>[0], ok: string) => {
    p.cmd(msgOut, ok);
    refresh();
  };

  useEffect(() => {
    if (!MUTE_CHOICES.includes(minutes) || minutes > muteMax) setMinutes(MUTE_CHOICES.filter((m) => m <= muteMax).at(-1) ?? 5);
  }, [minutes, muteMax]);

  const openSheet = async () => {
    const d = await p.run(() => staffApi.account(e.accountId));
    if (d) setSheet(d);
  };

  const doBan = async () => {
    if (!banReason.trim()) return p.notify('err', 'Informe o motivo do banimento.');
    const label = banMinutes === null ? 'permanentemente' : `por ${minutesLabel(banMinutes)}`;
    const ok = await p.confirm({
      title: `Banir ${e.name}?`,
      message: (
        <>
          A conta de <b>{e.name}</b> será banida <b>{label}</b>: a sessão cai agora e o login fica bloqueado. Motivo: “{banReason.trim()}”.
        </>
      ),
      confirmLabel: 'Banir conta',
      danger: true,
    });
    if (!ok) return;
    const r = await p.run(() => staffApi.ban(e.accountId, banMinutes, banReason.trim()), `${e.name} foi banido.`);
    if (r) {
      setMode(null);
      setBanReason('');
      refresh();
    }
  };

  const doKickSession = async () => {
    const ok = await p.confirm({
      title: `Expulsar ${e.name} da sessão?`,
      message: <>A pessoa será desconectada agora e poderá entrar de novo (não é banimento).</>,
      confirmLabel: 'Expulsar',
      danger: true,
    });
    if (ok) act({ t: 'staff_kick', target: e.id, scope: 'session', reason: reasonOrUndef }, `${e.name} foi expulso da sessão.`);
  };

  return (
    <div className="sf-card" data-testid="staff-player-actions">
      <h3 className="sf-card-title">
        {e.name} {e.staff && <Chip tone="gold">STAFF</Chip>}
      </h3>
      <p className="sf-card-sub">
        {e.roomName} · {e.orgName}
      </p>

      {self ? (
        <p className="sf-empty">Esta é a sua própria conta: ações de moderação não se aplicam a você.</p>
      ) : (
        <>
          <Field label="Motivo (opcional, registrado no log)">
            <input className="sf-input" value={reason} maxLength={MAX_STAFF_REASON} onChange={(ev) => setReason(ev.target.value)} placeholder="ex.: spam no chat" data-testid="staff-reason" />
          </Field>

          <div className="sf-group" role="group" aria-label="Movimentação">
            <button type="button" className="mini" disabled={!p.can('goto')} onClick={() => act({ t: 'staff_goto', target: e.id }, `Você foi até ${e.name}.`)} data-testid="staff-goto">
              Ir até
            </button>
            <button type="button" className="mini" disabled={!p.can('bring')} onClick={() => act({ t: 'staff_bring', target: e.id }, `${e.name} foi trazido até você.`)} data-testid="staff-bring">
              Trazer
            </button>
            <button type="button" className="mini" disabled={!p.can('kick.room') || ranked} onClick={() => act({ t: 'staff_kick', target: e.id, scope: 'room', reason: reasonOrUndef }, `${e.name} saiu da sala.`)} data-testid="staff-kickroom">
              Tirar da sala
            </button>
          </div>

          <div className="sf-group" role="group" aria-label="Silenciamento">
            <select className="sf-input sf-select" value={minutes} onChange={(ev) => setMinutes(Number(ev.target.value))} aria-label="Duração do silenciamento">
              {MUTE_CHOICES.filter((m) => m <= muteMax).map((m) => (
                <option key={m} value={m}>
                  {minutesLabel(m)}
                </option>
              ))}
            </select>
            <button type="button" className="mini" disabled={!p.can('mute') || ranked} onClick={() => act({ t: 'staff_mute', target: e.id, minutes, reason: reasonOrUndef }, `${e.name} silenciado por ${minutesLabel(minutes)}.`)} data-testid="staff-mute">
              Silenciar
            </button>
            <button type="button" className="mini" disabled={!p.can('unmute') || ranked || !e.muted} onClick={() => act({ t: 'staff_mute', target: e.id, minutes: 0 }, `${e.name} foi liberado.`)} data-testid="staff-unmute">
              Liberar
            </button>
          </div>

          <div className="sf-group" role="group" aria-label="Sessão e conta">
            <button type="button" className="mini danger" disabled={!p.can('kick.session') || ranked} onClick={() => void doKickSession()} data-testid="staff-kicksession">
              Expulsar da sessão
            </button>
            <button type="button" className={`mini danger ${mode === 'ban' ? 'on' : ''}`} disabled={!p.can('ban') || ranked || banChoices.length === 0} onClick={() => setMode(mode === 'ban' ? null : 'ban')} aria-expanded={mode === 'ban'} data-testid="staff-ban-open">
              Banir conta…
            </button>
          </div>

          {mode === 'ban' && (
            <div className="sf-sub" data-testid="staff-ban-form">
              <Field label="Duração">
                <select className="sf-input sf-select" value={banMinutes === null ? 'perm' : String(banMinutes)} onChange={(ev) => setBanMinutes(ev.target.value === 'perm' ? null : Number(ev.target.value))} data-testid="staff-ban-duration">
                  {banChoices.map((c) => (
                    <option key={c.label} value={c.minutes === null ? 'perm' : String(c.minutes)}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Motivo (obrigatório)">
                <input className="sf-input" value={banReason} maxLength={MAX_STAFF_REASON} onChange={(ev) => setBanReason(ev.target.value)} data-testid="staff-ban-reason" />
              </Field>
              <button type="button" className="mini danger" onClick={() => void doBan()} data-testid="staff-ban-confirm">
                Confirmar banimento
              </button>
            </div>
          )}

          <div className="sf-group" role="group" aria-label="Conta e mensagens">
            <button type="button" className="mini" disabled={!p.can('accounts.view')} onClick={() => void openSheet()} data-testid="staff-sheet-open">
              Ver ficha
            </button>
            <button type="button" className={`mini ${mode === 'msg' ? 'on' : ''}`} disabled={!p.can('dm')} onClick={() => setMode(mode === 'msg' ? null : 'msg')} aria-expanded={mode === 'msg'} data-testid="staff-msg-open">
              Mensagem de staff…
            </button>
            <button type="button" className={`mini ${mode === 'item' ? 'on' : ''}`} disabled={!p.can('item.grant')} onClick={() => setMode(mode === 'item' ? null : 'item')} aria-expanded={mode === 'item'} data-testid="staff-item-open">
              Itens…
            </button>
          </div>

          {mode === 'msg' && (
            <form
              className="sf-sub"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (!msg.trim()) return;
                act({ t: 'staff_dm', target: e.id, text: msg.trim() }, `Mensagem enviada a ${e.name}.`);
                setMsg('');
              }}
            >
              <Field label="Mensagem privada de staff (aparece em destaque para a pessoa)">
                <textarea className="sf-input" rows={2} maxLength={200} value={msg} onChange={(ev) => setMsg(ev.target.value)} data-testid="staff-msg-text" />
              </Field>
              <button className="mini gold" disabled={!msg.trim()} data-testid="staff-msg-send">
                Enviar mensagem
              </button>
            </form>
          )}

          {mode === 'item' && (
            <div className="sf-sub">
              <Field label="Chave do item" hint="Ex.: item:sp.mug_gold ou event:natal">
                <input className="sf-input" list="sf-item-keys" value={itemKey} maxLength={80} onChange={(ev) => setItemKey(ev.target.value)} data-testid="staff-item-key" />
                <datalist id="sf-item-keys">
                  <option value="event:natal" />
                  <option value="item:sp.mug_gold" />
                  <option value="achievement:pioneiro" />
                </datalist>
              </Field>
              <div className="sf-group">
                <button type="button" className="mini gold" disabled={!itemKey.trim()} onClick={() => act({ t: 'staff_item', target: e.accountId, key: itemKey.trim(), grant: true }, `Concedido ${itemKey.trim()}.`)} data-testid="staff-item-grant">
                  Conceder
                </button>
                <button type="button" className="mini" disabled={!itemKey.trim()} onClick={() => act({ t: 'staff_item', target: e.accountId, key: itemKey.trim(), grant: false }, `Revogado ${itemKey.trim()}.`)} data-testid="staff-item-revoke">
                  Revogar
                </button>
              </div>
            </div>
          )}

          {ranked && <p className="sf-hint">Staff de nível igual ou maior que o seu não pode ser moderada por aqui.</p>}
        </>
      )}

      {sheet && <Sheet d={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}

export function Sheet({ d, onClose, embedded = false }: { d: StaffAccountDetail; onClose(): void; embedded?: boolean }) {
  return (
    <div className={`sf-sheet${embedded ? ' sf-sheet-embedded' : ''}`} role={embedded ? 'region' : 'dialog'} aria-label={`Ficha de ${d.displayName}`} data-testid="staff-sheet">
      <div className="sf-sheet-head">
        <h4>Ficha · {d.displayName}</h4>
        {!embedded && (
          <button type="button" className="mini" onClick={onClose} aria-label="Fechar ficha">
            Fechar
          </button>
        )}
      </div>
      <dl className="sf-dl">
        <dt>E-mail</dt>
        <dd data-testid="staff-sheet-email">
          {d.email} {d.emailMasked && <Chip title="Só administradores veem o e-mail completo">mascarado</Chip>}
        </dd>
        <dt>Criada em</dt>
        <dd>{fmtDateTime(d.createdAt)}{d.createdBy ? ` · por ${d.createdBy}` : ''}</dd>
        <dt>Último login</dt>
        <dd>{fmtDateTime(d.lastLoginAt)}</dd>
        <dt>Situação</dt>
        <dd>
          {d.online ? <Chip tone="ok">online</Chip> : <Chip>offline</Chip>} {d.staff && <Chip tone="gold">staff: {d.staff}</Chip>} {d.banned && <Chip tone="bad">banida</Chip>}{' '}
          {d.disabled && <Chip tone="bad">desativada</Chip>} {d.muted && <Chip tone="warn">silenciada</Chip>} {d.mustChangePassword && <Chip tone="warn">trocar senha</Chip>}
        </dd>
        {d.ban && (
          <>
            <dt>Banimento</dt>
            <dd>
              {d.ban.until === null ? 'permanente' : `até ${fmtDateTime(d.ban.until)}`} · por {d.ban.by} · “{d.ban.reason}”
            </dd>
          </>
        )}
        {d.disabledInfo && (
          <>
            <dt>Desativação</dt>
            <dd>
              {fmtDateTime(d.disabledInfo.at)} · por {d.disabledInfo.by}
              {d.disabledInfo.reason ? ` · “${d.disabledInfo.reason}”` : ''}
            </dd>
          </>
        )}
        {d.mute && (
          <>
            <dt>Silenciamento</dt>
            <dd>
              até {fmtDateTime(d.mute.until)} · por {d.mute.by}
            </dd>
          </>
        )}
        <dt>Organizações</dt>
        <dd>
          {d.memberships.length === 0 && '—'}
          {d.memberships.map((m) => (
            <div key={m.orgId}>
              {m.orgName} · {m.role}
              {m.team ? ` · ${m.team}` : ''}
              {m.status !== 'active' ? ` (${m.status})` : ''}
            </div>
          ))}
        </dd>
        <dt>Desbloqueios</dt>
        <dd>{d.unlocks.length ? d.unlocks.join(', ') : 'nenhum'}</dd>
      </dl>
    </div>
  );
}
