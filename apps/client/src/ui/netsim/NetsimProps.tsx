import { useEffect, useState } from 'react';
import { DEVICE_LABEL, buildContext, ifaceViews, isHostKind, isL2Kind, isRouterKind, maskBits, type Cable, type Device, type NetOp, type Topology } from '@workverse/shared';
import { cableState } from './netsimLogic';

type Apply = (ops: NetOp[]) => void;

/** Campo de texto que so grava ao sair (blur) ou apertar Enter; Esc desfaz. */
function Field({ label, value, onCommit, disabled, placeholder, width, testId }: { label: string; value: string; onCommit(v: string): void; disabled?: boolean; placeholder?: string; width?: number; testId?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v.trim() !== value) onCommit(v.trim());
  };
  return (
    <label className="ns-field">
      <span>{label}</span>
      <input
        value={v}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={40}
        style={width ? { width } : undefined}
        data-testid={testId}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setV(value);
        }}
      />
    </label>
  );
}

function Check({ label, checked, onChange, disabled, testId }: { label: string; checked: boolean; onChange(v: boolean): void; disabled?: boolean; testId?: string }) {
  return (
    <label className="ns-check">
      <input type="checkbox" checked={checked} disabled={disabled} data-testid={testId} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

const maskText = (m?: string) => (m ? `/${maskBits(m)}` : '');

export function DeviceProps({ topo, dev, canEdit, apply, onDelete }: { topo: Topology; dev: Device; canEdit: boolean; apply: Apply; onDelete(): void }) {
  const ro = !canEdit;
  const views = ifaceViews(topo, dev.id, buildContext(topo));
  const cableOf = (name: string) => topo.cables.find((c) => (c.a.dev === dev.id && c.a.iface === name) || (c.b.dev === dev.id && c.b.iface === name));
  const [acl, setAcl] = useState({ action: 'deny', proto: 'icmp', src: 'any', dst: 'any', port: '' });
  const [route, setRoute] = useState({ net: '', mask: '24', via: '' });
  const [pool, setPool] = useState({ iface: '', start: '', end: '', gateway: '', dns: '' });
  const [sub, setSub] = useState({ parent: '', vlan: '' });
  const [rec, setRec] = useState({ domain: '', ip: '' });
  const router = isRouterKind(dev.kind) && dev.kind !== 'internet';
  const l2 = isL2Kind(dev.kind);
  const host = isHostKind(dev.kind);
  const physical = dev.ifaces.filter((i) => !i.parent);
  // so mostra interfaces com cabo ou configuradas em switches grandes
  const shown = l2 ? dev.ifaces.filter((i) => cableOf(i.name) || i.vlan || i.mode || i.shutdown) : dev.ifaces;

  return (
    <div className="ns-props" data-testid="netsim-props">
      <h3>
        {dev.name} <small>({DEVICE_LABEL[dev.kind]})</small>
      </h3>
      <div className="ns-row">
        <Field label="Nome" value={dev.name} disabled={ro} onCommit={(v) => apply([{ op: 'renameDevice', id: dev.id, name: v }])} testId="netsim-name" />
        <Check label="Desligado" checked={!!dev.off} disabled={ro} onChange={(v) => apply([{ op: 'setDevice', id: dev.id, patch: { off: v } }])} testId="netsim-off" />
      </div>

      {host && (
        <div className="ns-row">
          <Field label="Gateway" value={dev.gateway ?? ''} disabled={ro} placeholder="192.168.1.1" onCommit={(v) => apply([{ op: 'setDevice', id: dev.id, patch: { gateway: v || null } }])} testId="netsim-gateway" />
          <Field label="DNS" value={dev.dns ?? ''} disabled={ro} placeholder="8.8.8.8" onCommit={(v) => apply([{ op: 'setDevice', id: dev.id, patch: { dns: v || null } }])} testId="netsim-dns" />
        </div>
      )}

      <h4>Interfaces</h4>
      <ul className="ns-ifaces">
        {shown.map((i) => {
          const v = views.find((x) => x.name === i.name);
          const cable = cableOf(i.name);
          return (
            <li key={i.name} data-testid={`netsim-iface-${i.name}`}>
              <div className="ns-ifhead">
                <span className={`ns-led ${v?.up ? 'up' : 'down'}`} aria-label={v?.up ? 'ativa' : 'inativa'} title={v?.reason ?? 'ativa'} />
                <b>{i.name}</b>
                {cable && <span className="ns-dim"> ↔ {topo.devices.find((d) => d.id === (cable.a.dev === dev.id ? cable.b.dev : cable.a.dev))?.name}</span>}
                {!cable && !i.parent && <span className="ns-dim"> sem cabo</span>}
                {i.parent && (
                  <button type="button" className="ns-mini" disabled={ro} onClick={() => apply([{ op: 'removeSubif', id: dev.id, iface: i.name }])}>
                    remover
                  </button>
                )}
              </div>
              {!l2 && (
                <div className="ns-row">
                  {host && <Check label="DHCP" checked={!!i.dhcp} disabled={ro} onChange={(v2) => apply([{ op: 'setIface', id: dev.id, iface: i.name, patch: { dhcp: v2 } }])} testId={`netsim-dhcp-${i.name}`} />}
                  <Field
                    label="IP"
                    value={i.dhcp ? (v?.ip ?? '') : (i.ip ?? '')}
                    disabled={ro || !!i.dhcp}
                    placeholder="192.168.1.10"
                    onCommit={(val) => apply([{ op: 'setIface', id: dev.id, iface: i.name, patch: val ? { ip: val, mask: i.mask ?? '/24', dhcp: false } : { ip: null, mask: null } }])}
                    testId={`netsim-ip-${i.name}`}
                  />
                  <Field
                    label="Máscara"
                    value={i.dhcp ? (v?.bits !== undefined ? `/${v.bits}` : '') : (i.mask ? maskText(i.mask) : '')}
                    disabled={ro || !!i.dhcp}
                    width={110}
                    placeholder="/24"
                    onCommit={(val) => apply([{ op: 'setIface', id: dev.id, iface: i.name, patch: { mask: val || null } }])}
                    testId={`netsim-mask-${i.name}`}
                  />
                  {router && (
                    <label className="ns-field">
                      <span>NAT</span>
                      <select value={i.nat ?? ''} disabled={ro} onChange={(e) => apply([{ op: 'setIface', id: dev.id, iface: i.name, patch: { nat: e.target.value || null } }])}>
                        <option value="">—</option>
                        <option value="inside">inside</option>
                        <option value="outside">outside</option>
                      </select>
                    </label>
                  )}
                </div>
              )}
              {l2 && (
                <div className="ns-row">
                  <label className="ns-field">
                    <span>Modo</span>
                    <select value={i.mode ?? 'access'} disabled={ro} onChange={(e) => apply([{ op: 'setIface', id: dev.id, iface: i.name, patch: { mode: e.target.value } }])} data-testid={`netsim-mode-${i.name}`}>
                      <option value="access">access</option>
                      <option value="trunk">trunk</option>
                    </select>
                  </label>
                  {(i.mode ?? 'access') === 'access' ? (
                    <Field label="VLAN" value={String(i.vlan ?? 1)} disabled={ro} width={70} onCommit={(val) => apply([{ op: 'setIface', id: dev.id, iface: i.name, patch: { vlan: Number(val) || 0 } }])} testId={`netsim-vlan-${i.name}`} />
                  ) : (
                    <Field label="VLANs permitidas" value={(i.allowed ?? []).join(',')} disabled={ro} width={130} placeholder="todas" onCommit={(val) => apply([{ op: 'setIface', id: dev.id, iface: i.name, patch: { allowed: val ? val.split(',').map((x) => Number(x.trim())) : null } }])} testId={`netsim-allowed-${i.name}`} />
                  )}
                </div>
              )}
              <div className="ns-row">
                <Check label="Desativada (shutdown)" checked={!!i.shutdown} disabled={ro} onChange={(v2) => apply([{ op: 'setIface', id: dev.id, iface: i.name, patch: { shutdown: v2 } }])} testId={`netsim-shut-${i.name}`} />
                {v?.note && <span className="ns-warn">{v.note}</span>}
                {!v?.up && v?.reason && <span className="ns-warn">{v.reason}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {l2 && <p className="ns-dim">Mostrando só portas com cabo ou configuradas ({shown.length}/{dev.ifaces.length}).</p>}

      {router && (
        <>
          <Check label="NAT de saída ligado (sobrecarga)" checked={!!dev.natEnabled} disabled={ro} onChange={(v) => apply([{ op: 'setDevice', id: dev.id, patch: { natEnabled: v } }])} testId="netsim-nat" />
          <h4>Subinterfaces (router-on-a-stick)</h4>
          {!ro && (
            <div className="ns-row">
              <label className="ns-field">
                <span>Interface</span>
                <select value={sub.parent} onChange={(e) => setSub({ ...sub, parent: e.target.value })}>
                  <option value="">escolha</option>
                  {physical.map((i) => (
                    <option key={i.name}>{i.name}</option>
                  ))}
                </select>
              </label>
              <Field label="VLAN" value={sub.vlan} width={70} onCommit={(v) => setSub({ ...sub, vlan: v })} />
              <button type="button" className="ns-btn" disabled={!sub.parent || !sub.vlan} onClick={() => apply([{ op: 'addSubif', id: dev.id, parent: sub.parent, vlan: Number(sub.vlan) }])}>
                Criar
              </button>
            </div>
          )}

          <h4>Rotas estáticas</h4>
          <ul className="ns-list" data-testid="netsim-routes">
            {(dev.routes ?? []).map((r, k) => (
              <li key={`${r.net}${k}`}>
                {r.net}/{maskBits(r.mask)} via {r.via}
                <button type="button" className="ns-mini" disabled={ro} onClick={() => apply([{ op: 'removeRoute', id: dev.id, index: k }])}>
                  remover
                </button>
              </li>
            ))}
            {(dev.routes ?? []).length === 0 && <li className="ns-dim">nenhuma</li>}
          </ul>
          {!ro && (
            <div className="ns-row">
              <Field label="Rede" value={route.net} width={110} placeholder="0.0.0.0" onCommit={(v) => setRoute({ ...route, net: v })} testId="netsim-route-net" />
              <Field label="/bits" value={route.mask} width={50} onCommit={(v) => setRoute({ ...route, mask: v })} testId="netsim-route-mask" />
              <Field label="via" value={route.via} width={110} placeholder="203.0.113.1" onCommit={(v) => setRoute({ ...route, via: v })} testId="netsim-route-via" />
              <button type="button" className="ns-btn" disabled={!route.net || !route.via} onClick={() => apply([{ op: 'addRoute', id: dev.id, route: { net: route.net, mask: route.mask.startsWith('/') || route.mask.includes('.') ? route.mask : `/${route.mask}`, via: route.via } }])} data-testid="netsim-route-add">
                Adicionar
              </button>
            </div>
          )}

          <h4>Servidor DHCP</h4>
          <ul className="ns-list">
            {(dev.dhcp ?? []).map((p, k) => (
              <li key={k}>
                {p.iface}: {p.start} – {p.end}
                {p.gateway ? ` gw ${p.gateway}` : ''}
                {p.dns ? ` dns ${p.dns}` : ''}
                <button type="button" className="ns-mini" disabled={ro} onClick={() => apply([{ op: 'removePool', id: dev.id, index: k }])}>
                  remover
                </button>
              </li>
            ))}
            {(dev.dhcp ?? []).length === 0 && <li className="ns-dim">sem pool: clientes DHCP não recebem IP</li>}
          </ul>
          {!ro && (
            <div className="ns-row">
              <label className="ns-field">
                <span>Interface</span>
                <select value={pool.iface} onChange={(e) => setPool({ ...pool, iface: e.target.value })}>
                  <option value="">escolha</option>
                  {dev.ifaces.map((i) => (
                    <option key={i.name}>{i.name}</option>
                  ))}
                </select>
              </label>
              <Field label="Início" value={pool.start} width={105} onCommit={(v) => setPool({ ...pool, start: v })} />
              <Field label="Fim" value={pool.end} width={105} onCommit={(v) => setPool({ ...pool, end: v })} />
              <Field label="Gateway" value={pool.gateway} width={105} onCommit={(v) => setPool({ ...pool, gateway: v })} />
              <Field label="DNS" value={pool.dns} width={105} onCommit={(v) => setPool({ ...pool, dns: v })} />
              <button type="button" className="ns-btn" disabled={!pool.iface || !pool.start || !pool.end} onClick={() => apply([{ op: 'setPool', id: dev.id, pool: { iface: pool.iface, start: pool.start, end: pool.end, ...(pool.gateway ? { gateway: pool.gateway } : {}), ...(pool.dns ? { dns: pool.dns } : {}) } }])}>
                Adicionar
              </button>
            </div>
          )}

          {(dev.kind === 'router' || dev.kind === 'firewall') && (
            <>
              <h4>ACL (em ordem)</h4>
              <ul className="ns-list" data-testid="netsim-acl">
                {(dev.acl ?? []).map((r, k) => (
                  <li key={k}>
                    <b>{k + 1}.</b> {r.action} {r.proto} {r.src} → {r.dst}
                    {r.port ? `:${r.port}` : ''}
                    <button type="button" className="ns-mini" disabled={ro || k === 0} aria-label="subir" onClick={() => apply([{ op: 'moveAcl', id: dev.id, from: k, to: k - 1 }])}>
                      ↑
                    </button>
                    <button type="button" className="ns-mini" disabled={ro || k === (dev.acl ?? []).length - 1} aria-label="descer" onClick={() => apply([{ op: 'moveAcl', id: dev.id, from: k, to: k + 1 }])}>
                      ↓
                    </button>
                    <button type="button" className="ns-mini" disabled={ro} onClick={() => apply([{ op: 'removeAcl', id: dev.id, index: k }])}>
                      remover
                    </button>
                  </li>
                ))}
                {(dev.acl ?? []).length === 0 && <li className="ns-dim">sem regras (tudo passa)</li>}
              </ul>
              <label className="ns-field">
                <span>Política padrão (sem regra)</span>
                <select value={dev.aclDefault ?? 'permit'} disabled={ro} onChange={(e) => apply([{ op: 'setDevice', id: dev.id, patch: { aclDefault: e.target.value === 'deny' ? 'deny' : null } }])}>
                  <option value="permit">permit</option>
                  <option value="deny">deny</option>
                </select>
              </label>
              {!ro && (
                <div className="ns-row">
                  <label className="ns-field">
                    <span>Ação</span>
                    <select value={acl.action} onChange={(e) => setAcl({ ...acl, action: e.target.value })} data-testid="netsim-acl-action">
                      <option>permit</option>
                      <option>deny</option>
                    </select>
                  </label>
                  <label className="ns-field">
                    <span>Proto</span>
                    <select value={acl.proto} onChange={(e) => setAcl({ ...acl, proto: e.target.value })}>
                      {['ip', 'icmp', 'tcp', 'udp'].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  <Field label="Origem" value={acl.src} width={110} onCommit={(v) => setAcl({ ...acl, src: v || 'any' })} />
                  <Field label="Destino" value={acl.dst} width={110} onCommit={(v) => setAcl({ ...acl, dst: v || 'any' })} />
                  <Field label="Porta" value={acl.port} width={60} onCommit={(v) => setAcl({ ...acl, port: v })} />
                  <button
                    type="button"
                    className="ns-btn"
                    onClick={() => apply([{ op: 'addAcl', id: dev.id, rule: { action: acl.action, proto: acl.proto, src: acl.src, dst: acl.dst, ...(acl.port ? { port: Number(acl.port) } : {}) } }])}
                    data-testid="netsim-acl-add"
                  >
                    Adicionar
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {dev.kind === 'server' && (
        <>
          <h4>DNS local (registros)</h4>
          <ul className="ns-list">
            {Object.entries(dev.dnsRecords ?? {}).map(([d, ip]) => (
              <li key={d}>
                {d} → {ip}
                <button type="button" className="ns-mini" disabled={ro} onClick={() => apply([{ op: 'setDnsRecord', id: dev.id, domain: d, ip: null }])}>
                  remover
                </button>
              </li>
            ))}
            {Object.keys(dev.dnsRecords ?? {}).length === 0 && <li className="ns-dim">não é servidor DNS</li>}
          </ul>
          {!ro && (
            <div className="ns-row">
              <Field label="Domínio" value={rec.domain} width={130} placeholder="intranet.sim" onCommit={(v) => setRec({ ...rec, domain: v })} />
              <Field label="IP" value={rec.ip} width={110} onCommit={(v) => setRec({ ...rec, ip: v })} />
              <button type="button" className="ns-btn" disabled={!rec.domain || !rec.ip} onClick={() => apply([{ op: 'setDnsRecord', id: dev.id, domain: rec.domain, ip: rec.ip }])}>
                Adicionar
              </button>
            </div>
          )}
        </>
      )}

      {dev.kind === 'internet' && (
        <>
          <h4>Sites e DNS da Internet simulada</h4>
          <ul className="ns-list">
            {(dev.publicHosts ?? []).map((h) => (
              <li key={h.ip}>
                {h.ip} {h.name}
                {h.domains?.length ? ` · ${h.domains.join(', ')}` : ''}
                {h.dns ? ' · DNS' : ''}
              </li>
            ))}
          </ul>
        </>
      )}

      {!ro && (
        <button type="button" className="ns-btn danger" onClick={onDelete} data-testid="netsim-delete-dev">
          Remover {dev.name}
        </button>
      )}
    </div>
  );
}

export function CableProps({ topo, cable, canEdit, apply }: { topo: Topology; cable: Cable; canEdit: boolean; apply: Apply }) {
  const name = (id: string) => topo.devices.find((d) => d.id === id)?.name ?? '?';
  const st = cableState(topo, cable.id);
  return (
    <div className="ns-props" data-testid="netsim-cable-props">
      <h3>
        Cabo: {name(cable.a.dev)} {cable.a.iface} ↔ {name(cable.b.dev)} {cable.b.iface}
      </h3>
      <p className={st.up ? 'ns-ok' : 'ns-warn'}>{st.up ? 'Conectado (LEDs verdes)' : `Sem sinal: ${st.reason}`}</p>
      {canEdit && (
        <div className="ns-row">
          <button type="button" className="ns-btn" onClick={() => apply([{ op: 'setCable', id: cable.id, up: !cable.up }])} data-testid="netsim-cable-toggle">
            {cable.up ? 'Soltar cabo' : 'Reconectar cabo'}
          </button>
          <button type="button" className="ns-btn danger" onClick={() => apply([{ op: 'removeCable', id: cable.id }])} data-testid="netsim-cable-remove">
            Remover cabo
          </button>
        </div>
      )}
    </div>
  );
}
