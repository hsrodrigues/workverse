import { Icon } from '../../media/icons';
import { useEffect, useMemo, useState } from 'react';
import {
  FURNI_CATEGORY_LABELS,
  FURNI_KINDS,
  KIND_ROOM_TYPES,
  MAX_FURNITURE,
  categoryOf,
  type FurniCategory,
  type FurniKind,
} from '@workverse/shared';
import { Window } from '../Window';
import { useNetStatus } from '../../worldStore';
import { AccessTab } from './AccessTab';
import { canFurnishOf, canManageAccessOf, furnishStore, useFurnish } from './furnishStore';
import { thumbUrl } from './thumbs';
import './furnish.css';

/** "Decorar" button of the bottom bar: only people who may decorate (or manage access) see it; the server checks again anyway. */
export function FurnishBarButton() {
  const s = useFurnish();
  const [conn] = useNetStatus();
  if (!canFurnishOf(s) && !canManageAccessOf(s)) return null;
  return (
    <button
      type="button"
      className={`tool tool-furnish ${s.active ? 'on' : ''}`}
      onClick={() => furnishStore.setActive(!s.active)}
      disabled={conn !== 'online' || !s.def}
      title="Modo decoração: móveis e acesso da sala"
      aria-pressed={s.active}
      data-testid="furnish-button"
    >
      <span className="ico"><Icon name="pencil" /></span> Decorar sala
    </button>
  );
}

const CATEGORIES = Object.keys(FURNI_CATEGORY_LABELS) as FurniCategory[];

function isTyping(): boolean {
  const el = document.activeElement;
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

export function FurnishPanel() {
  const s = useFurnish();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FurniCategory | 'all'>('all');
  const [confirmReset, setConfirmReset] = useState(false);
  const canFurnish = canFurnishOf(s);
  const canAccess = canManageAccessOf(s);
  const active = s.active;

  // Shortcuts while decorating: R rotate, Del remove, Ctrl+Z / Ctrl+Y undo / redo, Esc cancel.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const k = e.key.toLowerCase();
      if (k === 'r' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        furnishStore.rotate();
      } else if (k === 'delete' || k === 'backspace') {
        e.preventDefault();
        furnishStore.removeSelected();
      } else if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        furnishStore.undo();
      } else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        furnishStore.redo();
      } else if (k === 'escape') {
        const st = furnishStore.get();
        if (st.tool) furnishStore.chooseTool(null);
        else if (st.selectedId) furnishStore.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  useEffect(() => {
    if (!confirmReset) return;
    const id = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(id);
  }, [confirmReset]);

  // The person lost the permission (role changed): leave the mode.
  useEffect(() => {
    if (active && !canFurnish && !canAccess) furnishStore.setActive(false);
  }, [active, canFurnish, canAccess]);

  const type = s.def?.type;
  const kinds = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (Object.keys(FURNI_KINDS) as FurniKind[]).filter((k) => {
      const only = KIND_ROOM_TYPES[k];
      if (only && !(type && only.includes(type))) return false;
      if (category !== 'all' && categoryOf(k) !== category) return false;
      return !q || FURNI_KINDS[k].label.toLowerCase().includes(q) || k.includes(q);
    });
  }, [query, category, type]);

  if (!active || !s.def) return null;
  const count = s.def.furniture.length;
  const selected = s.def.furniture.find((f) => f.id === s.selectedId);
  const tab = s.tab === 'access' && canAccess ? 'access' : 'furniture';
  const tip = s.hover && s.verdict && (s.tool || s.selectedId) ? s.verdict : null;

  return (
    <>
      <Window id="furnish" className="win panel panel-furnish" role="dialog" aria-label="Modo decoração" title={`Decorar · ${s.def.name}`} onClose={() => furnishStore.setActive(false)}>
        <div className="fz" data-testid="furnish-panel">
          <div className="fz-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'furniture'} className={tab === 'furniture' ? 'on' : ''} onClick={() => furnishStore.setTab('furniture')} disabled={!canFurnish}>
              Móveis
            </button>
            {canAccess && (
              <button role="tab" aria-selected={tab === 'access'} className={tab === 'access' ? 'on' : ''} onClick={() => furnishStore.setTab('access')} data-testid="furnish-tab-access">
                Acesso
              </button>
            )}
            <span className="fz-count" title="Peças na sala / limite" data-testid="furnish-count">
              {count}/{MAX_FURNITURE} peças
            </span>
          </div>

          {tab === 'furniture' && canFurnish && (
            <>
              <div className="fz-bar">
                <button type="button" className="mini" onClick={() => furnishStore.undo()} disabled={!s.canUndo || s.busy} title="Desfazer (Ctrl+Z)" data-testid="furnish-undo">
                  ↶ Desfazer
                </button>
                <button type="button" className="mini" onClick={() => furnishStore.redo()} disabled={!s.canRedo || s.busy} title="Refazer (Ctrl+Y)" data-testid="furnish-redo">
                  ↷ Refazer
                </button>
                <button type="button" className="mini" onClick={() => furnishStore.rotate()} disabled={!s.tool && !selected} title="Girar (R)" data-testid="furnish-rotate">
                  ⟳ Girar
                </button>
                <button type="button" className="mini danger" onClick={() => furnishStore.removeSelected()} disabled={!selected || s.busy} title="Excluir (Del)" data-testid="furnish-delete">
                  ✕ Excluir
                </button>
              </div>

              <div className="fz-mode" data-testid="furnish-mode">
                {s.tool ? (
                  <>
                    Colocando: <b>{FURNI_KINDS[s.tool].label}</b> <button className="mini" onClick={() => furnishStore.chooseTool(null)}>Cancelar</button>
                  </>
                ) : selected ? (
                  <>
                    Selecionado: <b>{FURNI_KINDS[selected.kind].label}</b> · arraste para mover
                  </>
                ) : (
                  <>Escolha uma peça abaixo, ou clique em uma peça da sala para mover.</>
                )}
              </div>

              <input className="fz-search" type="search" placeholder="Buscar móvel…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar móvel" data-testid="furnish-search" />
              <div className="fz-cats" role="group" aria-label="Categorias">
                <button type="button" className={category === 'all' ? 'on' : ''} onClick={() => setCategory('all')}>
                  Todos
                </button>
                {CATEGORIES.map((c) => (
                  <button key={c} type="button" className={category === c ? 'on' : ''} onClick={() => setCategory(c)}>
                    {FURNI_CATEGORY_LABELS[c]}
                  </button>
                ))}
              </div>

              <div className="fz-grid" data-testid="furnish-palette">
                {kinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`fz-item ${s.tool === k ? 'on' : ''}`}
                    onClick={() => furnishStore.chooseTool(s.tool === k ? null : k)}
                    title={`${FURNI_KINDS[k].label} (${FURNI_KINDS[k].w}×${FURNI_KINDS[k].d})`}
                    data-testid={`furnish-item-${k}`}
                  >
                    <span className="fz-thumb">
                      <img src={thumbUrl(k)} alt="" draggable={false} />
                    </span>
                    <span className="fz-name">{FURNI_KINDS[k].label}</span>
                  </button>
                ))}
                {kinds.length === 0 && <div className="fz-empty">Nenhuma peça encontrada.</div>}
              </div>

              <div className="fz-foot">
                {s.customized ? (
                  <button
                    type="button"
                    className={`mini ${confirmReset ? 'danger' : ''}`}
                    disabled={s.busy}
                    onClick={() => {
                      if (!confirmReset) return setConfirmReset(true);
                      setConfirmReset(false);
                      furnishStore.restore();
                    }}
                    data-testid="furnish-restore"
                  >
                    {confirmReset ? 'Clique de novo para confirmar' : 'Restaurar layout original da sala'}
                  </button>
                ) : (
                  <span className="fz-hint">Layout original (ainda sem alterações)</span>
                )}
              </div>
            </>
          )}

          {tab === 'access' && canAccess && <AccessTab />}

          <div className={`fz-status ${s.verdict && !s.verdict.ok ? 'bad' : s.notice?.kind ?? ''}`} role="status" aria-live="polite" data-testid="furnish-status">
            {s.verdict && !s.verdict.ok && s.tool ? (
              <>⛔ {s.verdict.reason}</>
            ) : s.verdict?.ok && s.verdict.warnings.length > 0 ? (
              <>⚠ {s.verdict.warnings[0]}</>
            ) : s.notice ? (
              <>{s.notice.kind === 'ok' ? '✔ ' : s.notice.kind === 'warn' ? '⚠ ' : '⛔ '}{s.notice.text}</>
            ) : (
              <span className="fz-hint">Versão {s.version} da sala · alterações valem na hora para todos.</span>
            )}
          </div>
        </div>
      </Window>
      {tip && s.hover && tab === 'furniture' && (!tip.ok || tip.warnings.length > 0) && (
        <div className={`fz-tip ${tip.ok ? 'warn' : 'bad'}`} style={{ left: Math.min(s.hover.cx + 16, window.innerWidth - 280), top: s.hover.cy + 18 }} data-testid="furnish-tip">
          {tip.ok ? `⚠ ${tip.warnings[0]}` : `⛔ ${tip.reason}`}
        </div>
      )}
    </>
  );
}
