import { useState } from 'react';
import {
  MAX_OUTFIT_NAME,
  OUTFIT_SUGGESTIONS,
  PALETTES,
  equippedOf,
  itemColors,
  sameAvatar,
  sanitizeOutfitName,
  type AvatarV2,
  type OutfitView,
  type WardrobeState,
} from '@workverse/shared';
import { ItemThumb, LookThumb } from './ItemThumb';

interface Props {
  avatar: AvatarV2;
  state: WardrobeState | null;
  loading: boolean;
  /** Error loading the wardrobe (the editor still works without it). */
  loadError: string;
  busy: boolean;
  onRetry(): void;
  onWear(outfit: OutfitView): void;
  onSave(name: string, id?: string): void;
  onDelete(outfit: OutfitView): void;
  onRemoveItem(itemId: string): void;
}

const REMOVABLE_FIELDS = /^(outer|facialHair|accessories|special)/;

export function WardrobePanel({ avatar, state, loading, loadError, busy, onRetry, onWear, onSave, onDelete, onRemoveItem }: Props) {
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const worn = equippedOf(avatar);
  const outfits = state?.outfits ?? [];
  const max = state?.maxOutfits ?? 12;
  const clean = sanitizeOutfitName(name, MAX_OUTFIT_NAME);
  const full = outfits.length >= max;
  const existing = clean ? outfits.find((o) => o.name.toLocaleLowerCase() === clean.toLocaleLowerCase()) : undefined;

  return (
    <div className="ae-wardrobe">
      <section className="ae-section" aria-labelledby="ae-worn-h">
        <h3 id="ae-worn-h">Vestindo agora</h3>
        <ul className="ae-worn">
          {worn.map((e) => {
            const color = e.item.palette ? itemColors(e.item).find((c) => c.id === e.ref.color) : undefined;
            const removable = REMOVABLE_FIELDS.test(e.field);
            return (
              <li key={e.field} className="ae-worn-row">
                <ItemThumb item={e.item} color={e.ref.color} skin={avatar.skin} compact />
                <span className="ae-worn-name">
                  <b>{e.item.name}</b>
                  <small>{color ? color.name : 'Cores fixas'}</small>
                </span>
                {removable ? (
                  <button type="button" className="chip" onClick={() => onRemoveItem(e.item.id)} aria-label={`Remover ${e.item.name}`}>
                    Remover
                  </button>
                ) : (
                  <span className="ae-worn-fixed">Essencial</span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="ae-desc">
          Pele: <b>{PALETTES.skin.colors.find((c) => c.id === avatar.skin)?.name ?? avatar.skin}</b>. Peças essenciais só podem ser trocadas, não removidas.
        </p>
      </section>

      <section className="ae-section" aria-labelledby="ae-save-h">
        <h3 id="ae-save-h">Salvar este visual como conjunto</h3>
        <form
          className="ae-save-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (clean) {
              onSave(clean, existing?.id);
              setName('');
            }
          }}
        >
          <label className="ae-label" htmlFor="ae-outfit-name">
            Nome do conjunto ({outfits.length}/{max})
          </label>
          <div className="ae-save-row">
            <input
              id="ae-outfit-name"
              className="ae-input"
              value={name}
              maxLength={MAX_OUTFIT_NAME}
              placeholder="Ex.: Reunião"
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={!clean || busy || (full && !existing)}>
              {existing ? 'Atualizar' : 'Salvar'}
            </button>
          </div>
          <div className="ae-filters" role="group" aria-label="Sugestões de nome">
            {OUTFIT_SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => setName(s)}>
                {s}
              </button>
            ))}
          </div>
          {full && !existing && <p className="ae-warn-box">Limite de {max} conjuntos atingido. Exclua um para salvar outro.</p>}
          {existing && <p className="ae-desc">Já existe um conjunto com esse nome: ele será atualizado com o visual atual.</p>}
        </form>
      </section>

      <section className="ae-section" aria-labelledby="ae-outfits-h">
        <h3 id="ae-outfits-h">Meus conjuntos</h3>
        {loading && <p className="ae-desc" role="status">Carregando seus conjuntos...</p>}
        {loadError && (
          <div className="ae-warn-box" role="alert">
            {loadError}{' '}
            <button type="button" className="chip" onClick={onRetry}>
              Tentar de novo
            </button>
          </div>
        )}
        {!loading && !loadError && outfits.length === 0 && <p className="ae-desc">Você ainda não salvou nenhum conjunto. Monte um visual e dê um nome a ele acima.</p>}
        <ul className="ae-outfits">
          {outfits.map((o) => {
            const current = sameAvatar(o.avatar, avatar);
            return (
              <li key={o.id} className={`ae-outfit ${current ? 'on' : ''} ${o.usable ? '' : 'locked'}`}>
                <LookThumb look={o.avatar} />
                <div className="ae-outfit-info">
                  <b>{o.name}</b>
                  {current && <small>Visual atual</small>}
                  {!o.usable && <small className="ae-warn">{o.problems[0] ?? 'Contém itens indisponíveis.'}</small>}
                </div>
                <div className="ae-outfit-actions">
                  <button type="button" className="chip" disabled={!o.usable || busy} onClick={() => onWear(o)} aria-label={`Vestir conjunto ${o.name}`}>
                    Vestir
                  </button>
                  <button type="button" className="chip" disabled={busy} onClick={() => onSave(o.name, o.id)} aria-label={`Atualizar conjunto ${o.name} com o visual atual`}>
                    Atualizar
                  </button>
                  {confirmDelete === o.id ? (
                    <button
                      type="button"
                      className="chip danger"
                      disabled={busy}
                      onClick={() => {
                        setConfirmDelete(null);
                        onDelete(o);
                      }}
                    >
                      Confirmar exclusão
                    </button>
                  ) : (
                    <button type="button" className="chip" disabled={busy} onClick={() => setConfirmDelete(o.id)} aria-label={`Excluir conjunto ${o.name}`}>
                      Excluir
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
