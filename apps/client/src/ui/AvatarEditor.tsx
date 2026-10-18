import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  DEFAULT_AVATAR,
  PALETTES,
  cloneAvatar,
  equipItem,
  randomAvatar,
  recolorItem,
  sameAvatar,
  setSkin,
  unequipItem,
  wornIds,
  type AvatarConfig,
  type ItemDef,
  type OutfitView,
  type WardrobeState,
} from '@workverse/shared';
import { ColorPicker } from './avatar/ColorPicker';
import { ItemSection, type SectionDef } from './avatar/ItemSection';
import { Preview } from './avatar/Preview';
import { SECTIONS, TABS, type TabId } from './avatar/tabs';
import { WardrobePanel } from './avatar/WardrobePanel';
import { AvatarRequestError, deleteOutfit, loadWardrobe, saveLook, saveOutfit } from './avatar/wardrobeApi';
import { Window } from './Window';
import './avatar/avatar-editor.css';

interface Props {
  initial: AvatarConfig;
  confirmLabel: string;
  /** Called after the server accepted and saved the look. */
  onConfirm(a: AvatarConfig): void;
  onCancel?(): void;
  embedded?: boolean;
}

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'success' } | { kind: 'error'; message: string; details: string[] };

const errorText = (err: unknown): { message: string; details: string[] } =>
  err instanceof AvatarRequestError
    ? { message: err.message, details: (err.issues ?? []).slice(1, 4).map((i) => i.message) }
    : { message: 'Não foi possível concluir. Tente novamente.', details: [] };

export function AvatarEditor({ initial, confirmLabel, onConfirm, onCancel, embedded }: Props) {
  const [saved, setSaved] = useState<AvatarConfig>(initial);
  const [draft, setDraft] = useState<AvatarConfig>(initial);
  const [tab, setTab] = useState<TabId>('hair');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [notice, setNotice] = useState('');
  const [wardrobe, setWardrobe] = useState<WardrobeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    loadWardrobe()
      .then(setWardrobe)
      .catch((err) => setLoadError(errorText(err).message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const unlocks = useMemo(() => new Set(wardrobe?.unlocks ?? []), [wardrobe]);
  const wearing = useMemo(() => wornIds(saved), [saved]);
  const changed = !sameAvatar(draft, saved);
  const saving = status.kind === 'saving' || status.kind === 'success';

  const edit = useCallback((next: AvatarConfig) => {
    setDraft(next);
    setStatus((s) => (s.kind === 'idle' ? s : { kind: 'idle' }));
  }, []);

  const equip = (item: ItemDef) => {
    const r = equipItem(draft, item.id);
    if (!r.ok) return setNotice(r.reason);
    edit(r.avatar);
    setNotice(r.removed.length > 0 ? `Removido para combinar: ${r.removed.map((i) => i.name).join(', ')}.` : `${item.name} equipado.`);
  };
  const remove = (item: ItemDef | undefined, _def?: SectionDef) => {
    if (!item) return;
    edit(unequipItem(draft, item.id));
    setNotice(`${item.name} removido.`);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNotice('');
    try {
      await fn();
    } catch (err) {
      const e = errorText(err);
      setStatus({ kind: 'error', message: e.message, details: e.details });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setStatus({ kind: 'saving' });
    try {
      const result = await saveLook(draft);
      setSaved(result);
      setDraft(result);
      setStatus({ kind: 'success' });
      window.setTimeout(() => onConfirm(result), 650);
    } catch (err) {
      const e = errorText(err);
      setStatus({ kind: 'error', message: e.message, details: e.details });
    }
  };

  const saveAsOutfit = (name: string, id?: string) =>
    run(async () => {
      setWardrobe(await saveOutfit(name, draft, id));
      setNotice(`Conjunto "${name}" salvo.`);
    });
  const removeOutfit = (o: OutfitView) =>
    run(async () => {
      setWardrobe(await deleteOutfit(o.id));
      setNotice(`Conjunto "${o.name}" excluído.`);
    });
  const wearOutfit = (o: OutfitView) => {
    edit(cloneAvatar(o.avatar));
    setNotice(`Conjunto "${o.name}" vestido. Confirme para salvar este visual.`);
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const to = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(TABS[to].id);
    tabRefs.current[TABS[to].id]?.focus();
  };

  // Escape cancels; Tab stays inside the editor while it is a modal.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && onCancel && !saving) {
      e.stopPropagation();
      onCancel();
    }
    if (e.key === 'Tab' && embedded && rootRef.current) {
      const f = [...rootRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]')].filter((el) => el.offsetParent !== null);
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === rootRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  useEffect(() => {
    rootRef.current?.focus();
  }, []);
  // Mobile: the tab strip scrolls sideways, so the chosen tab must stay in view.
  useEffect(() => {
    tabRefs.current[tab]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  const sectionProps = {
    avatar: draft,
    unlocks,
    wearing,
    onEquip: equip,
    onRemove: remove,
    onColor: (item: ItemDef, color: string) => edit(recolorItem(draft, item.id, color)),
    onNotice: setNotice,
  };

  const panel = (
    <Window
      id="avatar-editor"
      ref={rootRef}
      className="win ae-root"
      role="dialog"
      aria-modal={embedded ? true : undefined}
      aria-labelledby="ae-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-testid="avatar-editor"
    >
      <div className="win-title">
        <span id="ae-title">Seu visual</span>
        {onCancel && (
          <button type="button" className="x" onClick={onCancel} disabled={saving} aria-label="Fechar sem salvar">
            x
          </button>
        )}
      </div>
      <div className="ae-body">
        <Preview
          look={draft}
          saved={saved}
          changed={changed}
          onRandom={() => {
            edit(randomAvatar());
            setNotice('Visual aleatório aplicado. Confirme para salvar.');
          }}
        />
        <div className="ae-options">
          <div className="ae-tabs" role="tablist" aria-label="Categorias de personalização" onKeyDown={onTabKey}>
            {TABS.map((t) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                id={`ae-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls="ae-panel"
                tabIndex={tab === t.id ? 0 : -1}
                className={`tab ${tab === t.id ? 'on' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="ae-panel" id="ae-panel" role="tabpanel" aria-labelledby={`ae-tab-${tab}`} tabIndex={0}>
            {tab === 'face' && (
              <section className="ae-section" aria-labelledby="ae-skin-h">
                <h3 id="ae-skin-h">Tom de pele</h3>
                <ColorPicker label="Tom de pele" colors={PALETTES.skin.colors} value={draft.skin} onPick={(id) => edit(setSkin(draft, id))} />
              </section>
            )}
            {tab !== 'wardrobe' && SECTIONS[tab].map((def) => <ItemSection key={def.id} def={def} {...sectionProps} />)}
            {tab === 'wardrobe' && (
              <WardrobePanel
                avatar={draft}
                state={wardrobe}
                loading={loading}
                loadError={loadError}
                busy={busy}
                onRetry={load}
                onWear={wearOutfit}
                onSave={saveAsOutfit}
                onDelete={removeOutfit}
                onRemoveItem={(id) => edit(unequipItem(draft, id))}
              />
            )}
          </div>
        </div>
      </div>
      <div className="ae-live" role="status" aria-live="polite">
        {status.kind === 'saving' && 'Salvando seu visual...'}
        {status.kind === 'success' && 'Visual salvo!'}
        {status.kind === 'idle' && notice}
      </div>
      {status.kind === 'error' && (
        <div className="ae-error" role="alert">
          <b>Não foi possível salvar.</b> {status.message}
          {status.details.length > 0 && (
            <ul>
              {status.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="win-foot ae-foot">
        <span className="ae-foot-hint">{changed ? 'Alterações ainda não salvas' : 'Visual igual ao salvo'}</span>
        <button
          type="button"
          className="btn"
          disabled={saving || sameAvatar(draft, DEFAULT_AVATAR)}
          onClick={() => {
            edit(cloneAvatar(DEFAULT_AVATAR));
            setNotice('Visual padrão aplicado na pré-visualização. Confirme para salvar.');
          }}
        >
          Restaurar padrão
        </button>
        {onCancel && (
          <button type="button" className="btn" disabled={saving} onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button type="button" className={`btn btn-primary ${status.kind === 'success' ? 'ok' : ''}`} disabled={saving} onClick={() => void confirm()}>
          {status.kind === 'saving' ? 'Salvando...' : status.kind === 'success' ? 'Salvo!' : confirmLabel === 'Salvar' ? 'Confirmar' : confirmLabel}
        </button>
      </div>
    </Window>
  );

  return embedded ? panel : <div className="login ae-login">{panel}</div>;
}
