import { useCallback, useEffect, useState } from 'react';
import { STAFF_LABELS, STAFF_LEVELS, isStaffLevel, type StaffLevel, type StaffMemberRow } from '@workverse/shared';
import { Chip, Field, usePanel } from './staffUi';
import { staffApi } from './staffApi';

const LEVEL_HELP: Record<StaffLevel, string> = {
  helper: 'Ajudante: presença, ir/trazer, silenciar até 30 min, tirar da sala, avisar a sala.',
  moderator: 'Moderador: tudo do ajudante, expulsar da sessão, aviso global/da organização, contas (criar, redefinir senha, desativar, banir até 30 dias), salas e log.',
  admin: 'Administrador: tudo do moderador, banimento permanente, itens, e gerenciar esta equipe.',
};

export function TeamTab() {
  const p = usePanel();
  const [rows, setRows] = useState<StaffMemberRow[]>([]);
  const [identifier, setIdentifier] = useState('');
  const [level, setLevel] = useState<StaffLevel>('helper');
  const [busy, setBusy] = useState(false);
  const { run } = p;
  const manage = p.can('staff.manage');

  const load = useCallback(async () => {
    const r = await run(() => staffApi.team());
    if (r) setRows(r);
  }, [run]);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    const r = await run(() => staffApi.addStaff(identifier.trim(), level), `${identifier.trim()} agora faz parte da equipe (${STAFF_LABELS[level]}).`);
    setBusy(false);
    if (r) {
      setIdentifier('');
      void load();
    }
  };

  const change = async (m: StaffMemberRow, to: StaffLevel) => {
    if (to === m.level) return;
    const down = STAFF_LEVELS.indexOf(to) < STAFF_LEVELS.indexOf(m.level);
    const ok = await p.confirm({
      title: `${down ? 'Rebaixar' : 'Promover'} ${m.displayName}?`,
      message: (
        <>
          <b>{m.displayName}</b> passa de {STAFF_LABELS[m.level]} para <b>{STAFF_LABELS[to]}</b>. O efeito é imediato, inclusive se a pessoa estiver online.
          {m.id === p.selfId && <> Você está alterando o seu próprio nível.</>}
        </>
      ),
      confirmLabel: down ? 'Rebaixar' : 'Promover',
      danger: down,
    });
    if (ok && (await run(() => staffApi.setLevel(m.id, to), `${m.displayName} agora é ${STAFF_LABELS[to]}.`))) void load();
  };

  const remove = async (m: StaffMemberRow) => {
    const ok = await p.confirm({
      title: `Remover ${m.displayName} da equipe?`,
      message: <>A pessoa perde o painel, o selo e os poderes de staff agora mesmo. A conta continua existindo.</>,
      confirmLabel: 'Remover da equipe',
      danger: true,
    });
    if (ok && (await run(() => staffApi.removeStaff(m.id), `${m.displayName} saiu da equipe.`))) void load();
  };

  return (
    <div data-testid="staff-tab-team">
      {!manage && <p className="sf-hint sf-banner">Só administradores adicionam, alteram ou removem a equipe. Você pode ver a lista.</p>}
      {manage && (
        <form
          className="sf-card"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <h3 className="sf-card-title">Adicionar pessoa à equipe</h3>
          <div className="sf-grid2">
            <Field label="E-mail ou nome de exibição da conta">
              <input className="sf-input" value={identifier} maxLength={254} onChange={(e) => setIdentifier(e.target.value)} autoComplete="off" required data-testid="staff-team-identifier" />
            </Field>
            <Field label="Nível">
              <select className="sf-input sf-select" value={level} onChange={(e) => isStaffLevel(e.target.value) && setLevel(e.target.value)} data-testid="staff-team-level">
                {STAFF_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {STAFF_LABELS[l]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="sf-hint">{LEVEL_HELP[level]}</p>
          <button className="mini gold" disabled={busy || !identifier.trim()} data-testid="staff-team-add">
            Adicionar à equipe
          </button>
        </form>
      )}

      <h3 className="sf-h">Equipe ({rows.length})</h3>
      <ul className="sf-list" data-testid="staff-team-list">
        {rows.map((m) => (
          <li key={m.id} className="sf-teamrow" data-testid={`staff-member-${m.displayName}`}>
            <div className="sf-row-main">
              <b>{m.displayName}</b>
              <Chip tone="gold">{STAFF_LABELS[m.level]}</Chip>
              {m.online && <Chip tone="ok">online</Chip>}
              {m.envManaged && <Chip title="Definido por BOOTSTRAP_STAFF_EMAILS no servidor">via variável de ambiente</Chip>}
              {(m.banned || m.disabled) && <Chip tone="bad">{m.banned ? 'banida' : 'desativada'}</Chip>}
              {m.id === p.selfId && <em> (você)</em>}
              <span className="sf-row-sub">{m.email}</span>
            </div>
            {manage && (
              <div className="sf-group">
                <select
                  className="sf-input sf-select"
                  value={m.level}
                  disabled={m.envManaged}
                  onChange={(e) => isStaffLevel(e.target.value) && void change(m, e.target.value)}
                  aria-label={`Nível de ${m.displayName}`}
                  data-testid={`staff-member-level-${m.displayName}`}
                >
                  {STAFF_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {STAFF_LABELS[l]}
                    </option>
                  ))}
                </select>
                <button type="button" className="mini danger" disabled={m.envManaged} onClick={() => void remove(m)} data-testid={`staff-member-remove-${m.displayName}`}>
                  Remover
                </button>
              </div>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="sf-empty">Carregando…</li>}
      </ul>
    </div>
  );
}
