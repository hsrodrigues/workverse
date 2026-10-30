import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEVICE_KINDS, DEVICE_LABEL, buildContext, browse, isHostKind, isL2Kind, ping, testInternet, type DeviceKind, type NetOp, type SimResult, type Topology } from '@workverse/shared';
import { Window } from '../Window';
import { DeviceIcon } from './icons';
import { NetsimCanvas, type Selection, type Tool } from './NetsimCanvas';
import { CableProps, DeviceProps } from './NetsimProps';
import { formatSteps, freeIface, runTerminal, type TermLine } from './netsimLogic';
import { netsimStore, useNetsim } from './netsimStore';
import './netsim.css';

type Tab = 'props' | 'term' | 'test';
const PALETTE_KINDS = DEVICE_KINDS.filter((k) => k !== 'internet');

/**
 * Painel "Rede": simulador de rede da Sala da TI (estilo Packet Tracer, 100% simulado). Mostra a topologia da organizacao,
 * deixa a equipe de TI editar (adicionar equipamentos, cabos, IP, VLAN, rotas, NAT, ACL) e rodar testes com explicacao passo a
 * passo e um terminal por dispositivo. Os demais membros veem em modo leitura.
 */
export function NetsimPanel() {
  const ui = useNetsim();
  const s = ui.state;
  const topo: Topology | null = s?.topology ?? null;
  const canEdit = !!s?.canEdit;
  const [sel, setSel] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [cableFrom, setCableFrom] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState<Tab>('props');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!ui.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') netsimStore.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui.open]);

  // a selecao some se o dispositivo foi removido por outra pessoa
  const selDev = topo && sel?.kind === 'device' ? topo.devices.find((d) => d.id === sel.id) : undefined;
  const selCable = topo && sel?.kind === 'cable' ? topo.cables.find((c) => c.id === sel.id) : undefined;
  useEffect(() => {
    if (sel && topo && !selDev && !selCable) setSel(null);
  }, [sel, topo, selDev, selCable]);

  const apply = useCallback(async (ops: NetOp[]) => {
    const r = await netsimStore.edit(ops);
    setMsg(r.ok ? null : (r.error ?? 'Não foi possível aplicar.'));
    return r;
  }, []);

  if (!ui.open) return null;

  const addDevice = async (kind: DeviceKind) => {
    if (!topo) return;
    const b = topo.devices.length;
    const x = 40 + (b % 8) * 70;
    const y = 40 + Math.floor(b / 8) * 90;
    const r = await apply([{ op: 'addDevice', kind, x, y }]);
    if (r.ok) setTab('props');
  };

  const cableClick = async (id: string) => {
    if (!topo || !canEdit) return;
    if (!cableFrom) {
      setCableFrom(id);
      setMsg(`Escolha o segundo dispositivo para ligar com ${topo.devices.find((d) => d.id === id)?.name}.`);
      return;
    }
    if (cableFrom === id) {
      setCableFrom(null);
      setMsg(null);
      return;
    }
    const ai = freeIface(topo, cableFrom);
    const bi = freeIface(topo, id);
    setCableFrom(null);
    if (!ai || !bi) {
      setMsg('Um dos dispositivos não tem interface livre.');
      return;
    }
    const r = await apply([{ op: 'addCable', a: { dev: cableFrom, iface: ai }, b: { dev: id, iface: bi } }]);
    if (r.ok) setMsg('Cabo conectado. Ajuste as interfaces no painel ao lado.');
  };

  const del = async () => {
    if (selDev && (await apply([{ op: 'removeDevice', id: selDev.id }])).ok) setSel(null);
  };

  return (
    <Window id="netsim" className="win panel panel-netsim" title="Rede · Simulador da TI" onClose={() => netsimStore.close()} role="dialog" aria-label="Simulador de rede da TI" bodyClassName="ns-body">
      <div className="ns" data-testid="netsim-panel">
        <p className="ns-note">
          Tudo aqui é <b>simulado</b>: nenhum pacote real sai do WorkVerse.{' '}
          {canEdit ? <span className="ns-badge edit">Você pode editar</span> : <span className="ns-badge ro" data-testid="netsim-readonly">Modo leitura (somente a TI edita)</span>}
          {s && <span className="ns-dim"> · versão {s.version}{s.version === 0 ? ' (modelo do inventário)' : ''}{s.updatedBy ? ` · por ${s.updatedBy}` : ''}</span>}
          {ui.busy && <span className="ns-dim"> · aguarde…</span>}
        </p>
        {(msg || ui.notice) && (
          <p className="ns-alert" role="alert" data-testid="netsim-notice">
            {msg ?? ui.notice}
            <button type="button" className="ns-mini" onClick={() => { setMsg(null); netsimStore.dismissNotice(); }}>
              ok
            </button>
          </p>
        )}
        {s && s.omitted > 0 && <p className="ns-dim">{s.omitted} estação(ões) do inventário ficaram de fora por causa do limite de dispositivos.</p>}

        {canEdit && (
          <div className="ns-toolbar" role="toolbar" aria-label="Ferramentas da rede">
            <div className="ns-pal" aria-label="Adicionar equipamento">
              {PALETTE_KINDS.map((k) => (
                <button key={k} type="button" className="ns-tool" onClick={() => void addDevice(k)} title={`Adicionar ${DEVICE_LABEL[k]}`} aria-label={`Adicionar ${DEVICE_LABEL[k]}`} data-testid={`netsim-add-${k}`}>
                  <DeviceIcon kind={k} size={22} />
                  <span>{DEVICE_LABEL[k]}</span>
                </button>
              ))}
            </div>
            <div className="ns-pal">
              <button type="button" className={`ns-btn${tool === 'cable' ? ' on' : ''}`} aria-pressed={tool === 'cable'} onClick={() => { setTool(tool === 'cable' ? 'select' : 'cable'); setCableFrom(null); }} data-testid="netsim-tool-cable">
                {tool === 'cable' ? 'Cabo: clique em 2 dispositivos' : 'Cabo'}
              </button>
              <button type="button" className="ns-btn" disabled={!s?.canUndo} onClick={() => netsimStore.undo()} data-testid="netsim-undo">
                Desfazer
              </button>
              <button type="button" className="ns-btn danger" onClick={() => { if (window.confirm('Restaurar o modelo padrão gerado do inventário? Suas alterações viram uma versão desfazível.')) netsimStore.reset(); }} data-testid="netsim-reset">
                Restaurar padrão
              </button>
            </div>
          </div>
        )}

        <div className="ns-main">
          <div className="ns-left">
            <div className="ns-zoom">
              <button type="button" className="ns-mini" aria-label="Afastar" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>
                −
              </button>
              <button type="button" className="ns-mini" aria-label="Ajustar à tela" onClick={() => setZoom(1)}>
                ajustar
              </button>
              <button type="button" className="ns-mini" aria-label="Aproximar" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>
                +
              </button>
              {topo && (
                <label className="ns-pick">
                  <span className="sr-only">Selecionar dispositivo</span>
                  <select value={sel?.kind === 'device' ? sel.id : ''} onChange={(e) => setSel(e.target.value ? { kind: 'device', id: e.target.value } : null)} aria-label="Selecionar dispositivo" data-testid="netsim-select">
                    <option value="">Dispositivo…</option>
                    {topo.devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {topo ? (
              <NetsimCanvas
                topo={topo}
                selection={sel}
                tool={canEdit ? tool : 'select'}
                cableFrom={cableFrom}
                canEdit={canEdit}
                zoom={zoom}
                onSelect={(x) => { setSel(x); if (x) setTab('props'); }}
                onMove={(id, x, y) => void apply([{ op: 'moveDevice', id, x, y }])}
                onCableClick={(id) => void cableClick(id)}
              />
            ) : (
              <p className="ns-dim">Carregando a rede…</p>
            )}
            <p className="ns-legend ns-dim" aria-hidden="true">
              <span className="ns-led up" /> cabo ativo <span className="ns-led down" /> sem sinal
            </p>
          </div>

          <div className="ns-right">
            <div className="ns-tabs" role="tablist">
              {(['props', 'term', 'test'] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={`netsim-tab-${t}`}>
                  {t === 'props' ? 'Propriedades' : t === 'term' ? 'Terminal' : 'Testar'}
                </button>
              ))}
            </div>
            <div className="ns-tabbody" role="tabpanel">
              {tab === 'props' && topo && (
                <>
                  {selDev && <DeviceProps topo={topo} dev={selDev} canEdit={canEdit} apply={(ops) => void apply(ops)} onDelete={() => void del()} />}
                  {selCable && <CableProps topo={topo} cable={selCable} canEdit={canEdit} apply={(ops) => void apply(ops)} />}
                  {!selDev && !selCable && <p className="ns-dim">Selecione um dispositivo ou cabo no desenho (ou na lista) para ver e ajustar as propriedades.</p>}
                </>
              )}
              {tab === 'term' && topo && <Terminal topo={topo} devId={selDev?.id ?? null} canEdit={canEdit} />}
              {tab === 'test' && topo && <TestTab topo={topo} devId={selDev?.id ?? null} />}
            </div>
          </div>
        </div>
      </div>
    </Window>
  );
}

// ---------------------------------------------------------------- terminal

const WELCOME: TermLine = { text: 'Terminal simulado. Digite help para ver os comandos.', kind: 'dim' };

function Terminal({ topo, devId, canEdit }: { topo: Topology; devId: string | null; canEdit: boolean }) {
  const logs = useRef(new Map<string, TermLine[]>());
  const hist = useRef(new Map<string, string[]>());
  const [, bump] = useState(0);
  const [line, setLine] = useState('');
  const [cursor, setCursor] = useState(-1);
  const end = useRef<HTMLDivElement>(null);
  const dev = devId ? topo.devices.find((d) => d.id === devId) : undefined;
  const log = devId ? (logs.current.get(devId) ?? [WELCOME]) : [];

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  });

  if (!dev) return <p className="ns-dim">Selecione um dispositivo para abrir o terminal dele.</p>;

  const push = (id: string, lines: TermLine[], clear = false) => {
    const cur = clear ? [] : (logs.current.get(id) ?? [WELCOME]);
    logs.current.set(id, [...cur, ...lines].slice(-300));
    bump((n) => n + 1);
  };

  const submit = async () => {
    const text = line;
    setLine('');
    setCursor(-1);
    if (!text.trim()) return;
    const h = hist.current.get(dev.id) ?? [];
    hist.current.set(dev.id, [...h.filter((x) => x !== text), text].slice(-40));
    const out = runTerminal(text, { topo, dev, canEdit });
    push(dev.id, [{ text: `${dev.name}> ${text}`, kind: 'cmd' }, ...out.lines], out.clear);
    if (out.ops) {
      const r = await netsimStore.edit(out.ops);
      push(dev.id, [r.ok ? { text: 'OK (alteração salva na rede da organização).', kind: 'ok' } : { text: `Erro: ${r.error}`, kind: 'err' }]);
    }
  };

  return (
    <div className="ns-term" data-testid="netsim-term">
      <div className="ns-termlog" role="log" aria-live="polite" aria-label={`Terminal de ${dev.name}`}>
        {log.map((l, k) => (
          <div key={k} className={`tl ${l.kind}`}>
            {l.text}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        className="ns-termform"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          <span className="ns-prompt">{dev.name}&gt;</span>
          <input
            value={line}
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            aria-label={`Comando para ${dev.name}`}
            data-testid="netsim-term-input"
            onChange={(e) => setLine(e.target.value)}
            onKeyDown={(e) => {
              const h = hist.current.get(dev.id) ?? [];
              if (e.key === 'ArrowUp' && h.length) {
                e.preventDefault();
                const n = Math.min(h.length - 1, cursor + 1);
                setCursor(n);
                setLine(h[h.length - 1 - n]!);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                const n = cursor - 1;
                setCursor(n);
                setLine(n >= 0 ? h[h.length - 1 - n]! : '');
              }
            }}
          />
        </label>
        <button type="submit" className="ns-btn">
          Enviar
        </button>
      </form>
      {!canEdit && <p className="ns-dim">Modo leitura: testes e consultas funcionam; comandos que alteram a rede são negados.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- testar

function ResultView({ r, title }: { r: SimResult; title: string }) {
  return (
    <div className="ns-result" data-testid="netsim-result" data-ok={r.ok ? '1' : '0'}>
      <p className={`ns-sum ${r.ok ? 'ok' : 'bad'}`} role="status">
        <b>{r.ok ? '✔' : '✘'} {title}</b>
        <br />
        {r.summary}
      </p>
      <ol className="ns-steps">
        {formatSteps(r).map((l, k) => (
          <li key={k} className={l.kind}>
            {l.text.replace(/^[✔✘!·] /, '')}
          </li>
        ))}
      </ol>
    </div>
  );
}

function TestTab({ topo, devId }: { topo: Topology; devId: string | null }) {
  const dev = devId ? topo.devices.find((d) => d.id === devId) : undefined;
  const [target, setTarget] = useState('8.8.8.8');
  const [url, setUrl] = useState('http://exemplo.sim');
  const [res, setRes] = useState<{ title: string; r: SimResult } | null>(null);
  const ctx = useMemo(() => buildContext(topo), [topo]);
  useEffect(() => setRes(null), [devId]);
  if (!dev) return <p className="ns-dim">Selecione um PC, servidor ou roteador para testar a conexão dele.</p>;
  if (isL2Kind(dev.kind) || dev.kind === 'internet') return <p className="ns-dim">{dev.name} não gera pacotes IP. Selecione um PC, servidor ou roteador.</p>;
  return (
    <div className="ns-test">
      <h3>{dev.name}</h3>
      {isHostKind(dev.kind) && (
        <button type="button" className="ns-btn big" onClick={() => setRes({ title: 'Testar internet', r: testInternet(topo, dev.id, ctx) })} data-testid="netsim-test-internet">
          Testar internet
        </button>
      )}
      <div className="ns-row">
        <label className="ns-field">
          <span>Ping</span>
          <input value={target} maxLength={60} onChange={(e) => setTarget(e.target.value)} aria-label="Destino do ping" data-testid="netsim-ping-target" />
        </label>
        <button type="button" className="ns-btn" onClick={() => setRes({ title: `Ping ${target}`, r: ping(topo, dev.id, target, ctx) })} data-testid="netsim-ping-go">
          Pingar
        </button>
      </div>
      <div className="ns-row">
        <label className="ns-field">
          <span>Navegar</span>
          <input value={url} maxLength={80} onChange={(e) => setUrl(e.target.value)} aria-label="Endereço do site" data-testid="netsim-browse-target" />
        </label>
        <button type="button" className="ns-btn" onClick={() => setRes({ title: `Navegar até ${url}`, r: browse(topo, dev.id, url, ctx) })} data-testid="netsim-browse-go">
          Abrir
        </button>
      </div>
      {res && <ResultView r={res.r} title={res.title} />}
    </div>
  );
}
