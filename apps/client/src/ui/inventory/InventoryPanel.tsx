import { useEffect, useMemo, useRef, useState } from 'react';
import { badgeTextColor, formatUptime, safeDeptColor, type InventoryHost } from '@workverse/shared';
import { emit } from '../../bus';
import { net } from '../../net';
import { useWorld, worldStore } from '../../worldStore';
import { Window } from '../Window';
import { HIDDEN_ROOM, STATUS_GLYPH, STATUS_TEXT, countByRoom, cpuBar, filterHosts, roomKeyOf, whereText } from './inventoryLogic';
import './inventory.css';

const REFRESH_MS = 5000;

/**
 * "Servidores · Inventario de PCs": terminal retro que lista os PCs conectados no escritorio (cada estacao de trabalho da
 * organizacao), derivado do estado real do mundo. So abre para a equipe de TI, staff e admins (o servidor decide e manda
 * `inventory_open`). Filtra por sala e setor, busca por nome, host ou IP; "Localizar" aponta a estacao no mapa, "Ping" e
 * "Reiniciar" sao cosmeticos (ninguem e derrubado).
 */
export function InventoryPanel() {
  const w = useWorld();
  const inv = w.inventory;
  const [room, setRoom] = useState('');
  const [dept, setDept] = useState('');
  const [q, setQ] = useState('');
  const search = useRef<HTMLInputElement>(null);

  // atualiza a lista de tempos em tempos enquanto o painel esta aberto
  useEffect(() => {
    if (!inv.open) return;
    const id = setInterval(() => worldStore.refreshInventory(), REFRESH_MS);
    search.current?.focus();
    return () => clearInterval(id);
  }, [inv.open]);

  // Esc fecha mesmo quando o foco nao esta dentro da janela
  useEffect(() => {
    if (!inv.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') worldStore.closeInventory();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inv.open]);

  const result = inv.result;
  const hosts = result?.hosts ?? [];
  const counts = useMemo(() => countByRoom(hosts), [hosts]);
  const shown = useMemo(() => filterHosts(hosts, { room, dept, q }), [hosts, room, dept, q]);

  if (!inv.open) return null;

  const here = w.room?.id;
  const locate = (h: InventoryHost) => {
    if (h.hidden || !h.roomId || h.x === undefined || h.y === undefined) return;
    emit('locateHost', { roomId: h.roomId, x: h.x, y: h.y, label: h.hostname });
    if (h.roomId !== here) net.send({ t: 'join', roomId: h.roomId });
    worldStore.closeInventory();
  };

  const rooms = result?.rooms ?? [];
  const hiddenCount = counts.get(HIDDEN_ROOM);
  const total = result?.total ?? 0;
  const powered = result?.powered ?? 0;
  const busy = result?.busy ?? 0;

  return (
    <Window id="inventory" className="win panel panel-inventory" title="Servidores · Inventário de PCs" onClose={() => worldStore.closeInventory()} role="dialog" aria-label="Servidores: inventário de PCs conectados" bodyClassName="inv-body">
      <div className="inv" data-testid="inventory-panel">
        <p className="inv-prompt" aria-hidden="true">
          <span>workverse@ti-servidores:~$</span> inventario --pcs<i className="inv-cursor" />
        </p>

        {inv.notice && (
          <p className="inv-notice" role="alert" data-testid="inventory-notice">
            {inv.notice}
          </p>
        )}

        <div className="inv-stats" data-testid="inventory-stats" aria-live="polite">
          <span>
            PCs ligados: <b data-testid="inventory-powered">{powered}</b>/<b data-testid="inventory-total">{total}</b>
          </span>
          <span>
            em uso: <b data-testid="inventory-busy">{busy}</b>
          </span>
          {inv.busy && <span className="inv-wait">consultando…</span>}
        </div>

        <div className="inv-filters">
          <label>
            sala
            <select value={room} onChange={(e) => setRoom(e.target.value)} data-testid="inventory-room">
              <option value="">todas ({total})</option>
              {rooms.map((r) => {
                const c = counts.get(r.id);
                return (
                  <option key={r.id} value={r.id}>
                    {r.name} ({c ? `${c.powered}/${c.total}` : '0'})
                  </option>
                );
              })}
              {hiddenCount && (
                <option value={HIDDEN_ROOM}>
                  salas privadas ({hiddenCount.powered}/{hiddenCount.total})
                </option>
              )}
            </select>
          </label>
          <label>
            setor
            <select value={dept} onChange={(e) => setDept(e.target.value)} data-testid="inventory-dept">
              <option value="">todos</option>
              {(result?.depts ?? []).map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="inv-search">
            buscar
            <input ref={search} type="search" value={q} maxLength={40} onChange={(e) => setQ(e.target.value)} placeholder="nome, hostname ou IP" aria-label="Buscar por nome, hostname ou IP" data-testid="inventory-search" />
          </label>
        </div>

        <div className="inv-scroll">
          <table className="inv-table" data-testid="inventory-table">
            <caption className="sr-only">PCs conectados no escritório</caption>
            <thead>
              <tr>
                <th scope="col">Host / IP</th>
                <th scope="col">Sala</th>
                <th scope="col">Estado</th>
                <th scope="col">Usuário</th>
                <th scope="col">Tempo</th>
                <th scope="col">CPU</th>
                <th scope="col">Ações</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((h) => {
                const pending = inv.pending[h.id];
                const user = h.users[0];
                return (
                  <tr key={h.id} className={`inv-row st-${h.status}`} data-testid={`inventory-row-${h.hostname}`} data-status={h.status}>
                    <th scope="row">
                      <span className="inv-host">{h.hostname}</span>
                      <span className="inv-ip">{h.ip}</span>
                    </th>
                    <td data-label="Sala">{whereText(h)}</td>
                    <td data-label="Estado">
                      <span className={`inv-status st-${h.status}`}>
                        <span aria-hidden="true">{STATUS_GLYPH[h.status]}</span> {STATUS_TEXT[h.status]}
                      </span>
                    </td>
                    <td data-label="Usuário">
                      {user ? (
                        <span className="inv-user" data-testid="inventory-user">
                          <b>{user.name}</b>
                          {h.users.length > 1 && <em> +{h.users.length - 1}</em>}
                          <span className="inv-role">
                            {user.dept && (
                              <span className="inv-dept" style={{ background: safeDeptColor(user.deptColor), color: badgeTextColor(safeDeptColor(user.deptColor)) }}>
                                {user.dept}
                              </span>
                            )}
                            {user.title && <span> {user.title}</span>}
                          </span>
                        </span>
                      ) : (
                        <span className="inv-none">—</span>
                      )}
                    </td>
                    <td data-label="Tempo">{user ? formatUptime(user.upMs) : '—'}</td>
                    <td data-label="CPU" className="inv-cpu" title={`${h.cpu}%`}>
                      <span aria-hidden="true">{cpuBar(h.cpu)}</span> <span>{h.cpu}%</span>
                    </td>
                    <td data-label="Ações" className="inv-actions">
                      {!h.hidden && h.roomId === here && (
                        <button type="button" className="inv-btn" onClick={() => locate(h)} data-testid={`inventory-locate-${h.hostname}`}>
                          Localizar
                        </button>
                      )}
                      {!h.hidden && h.roomId !== here && (
                        <button type="button" className="inv-btn" onClick={() => locate(h)} data-testid={`inventory-goto-${h.hostname}`}>
                          Ir até a sala
                        </button>
                      )}
                      {!h.hidden && (
                        <>
                          <button type="button" className="inv-btn" disabled={!!pending} onClick={() => worldStore.inventoryAction(h.id, 'ping')} data-testid={`inventory-ping-${h.hostname}`}>
                            {pending === 'ping' ? 'ping…' : 'Ping'}
                          </button>
                          <button type="button" className="inv-btn warn" disabled={!!pending || h.status === 'off'} onClick={() => worldStore.inventoryAction(h.id, 'reboot')} data-testid={`inventory-reboot-${h.hostname}`}>
                            {pending === 'reboot' ? 'reiniciando…' : 'Reiniciar'}
                          </button>
                        </>
                      )}
                      {h.hidden && <span className="inv-none">sem acesso</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && !inv.busy && (
            <p className="inv-empty" data-testid="inventory-empty">
              Nenhum PC encontrado com esses filtros.
            </p>
          )}
        </div>
        {result?.truncated && <p className="inv-more">Mostrando só os primeiros {hosts.length} PCs: use os filtros para refinar.</p>}

        <div className="inv-log" role="log" aria-live="polite" aria-label="Respostas do terminal" data-testid="inventory-log">
          {inv.log.length === 0 ? <span className="inv-none">&gt; aguardando comandos…</span> : inv.log.map((l) => (
            <div key={l.key} className={l.ok ? '' : 'bad'}>
              &gt; {l.text}
            </div>
          ))}
        </div>
      </div>
    </Window>
  );
}
