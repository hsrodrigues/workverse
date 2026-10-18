import { useState } from 'react';
import {
  POSES,
  accessOf,
  describeUnlock,
  itemColors,
  type AvatarV2,
  type ItemDef,
  type ItemSlot,
  type Pose,
} from '@workverse/shared';
import { ColorPicker } from './ColorPicker';
import { ItemThumb } from './ItemThumb';
import { wornInSlot } from './helpers';

export interface Filter {
  id: string;
  label: string;
  tag?: string;
}

export interface SectionDef {
  id: string;
  title: string;
  slot: ItemSlot;
  /** Items of the section (already limited to the category). */
  items: readonly ItemDef[];
  /** Optional slots can be cleared ("Nenhum"). */
  removable?: boolean;
  noneLabel?: string;
  filters?: readonly Filter[];
}

interface Props {
  def: SectionDef;
  avatar: AvatarV2;
  unlocks: ReadonlySet<string>;
  wearing: ReadonlySet<string>;
  onEquip(item: ItemDef): void;
  onRemove(item: ItemDef | undefined, def: SectionDef): void;
  onColor(item: ItemDef, color: string): void;
  onNotice(message: string): void;
}

const POSE_LABEL: Record<Pose, string> = { idle: 'parado', walk: 'andando', sit: 'sentado', wave: 'acenando' };
const RARITY_LABEL: Record<string, string> = { uncommon: 'Incomum', rare: 'Raro', epic: 'Épico', legendary: 'Lendário' };

/** Poses in which an item is not drawn (declared in the catalog), for the info line. */
function missingPoses(item: ItemDef): string[] {
  return POSES.filter((p) => item.poses[p] === 'hidden').map((p) => POSE_LABEL[p]);
}

/** How to get a locked item: the origin from the catalog, and who to ask when it is handed out by the team. */
function lockedText(item: ItemDef): string {
  const how = describeUnlock(item.unlock);
  const ask = item.unlock === 'staff' || item.unlock.startsWith('event:') ? ' Peça a um administrador.' : '';
  return `"${item.name}" está bloqueado. Como desbloquear: ${how}.${ask}`;
}

export function ItemSection({ def, avatar, unlocks, wearing, onEquip, onRemove, onColor, onNotice }: Props) {
  const [filter, setFilter] = useState('all');
  const wornAny = wornInSlot(avatar, def.slot);
  // A slot can be shared by two sections (hats and party hats): only show what belongs to this one.
  const worn = wornAny && def.items.some((i) => i.id === wornAny.item.id) ? wornAny : undefined;
  const wornItem = worn?.item;
  const active = def.filters?.find((f) => f.id === filter);
  const shown = def.items.filter((i) => {
    const acc = accessOf(i, { unlocks, wearing });
    if (acc === 'hidden' || acc === 'retired') return false; // not offered (kept while worn through `wearing`)
    return !active?.tag || i.tags.includes(active.tag);
  });
  const colors = wornItem ? itemColors(wornItem) : [];
  const missing = wornItem ? missingPoses(wornItem) : [];
  const headingId = `ae-sec-${def.id}`;

  return (
    <section className="ae-section" aria-labelledby={headingId}>
      <h3 id={headingId}>{def.title}</h3>
      {def.filters && (
        <div className="ae-filters" role="group" aria-label={`Filtrar ${def.title}`}>
          {[{ id: 'all', label: 'Todos' }, ...def.filters].map((f) => (
            <button key={f.id} type="button" className={`chip ${filter === f.id ? 'on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      )}
      <div className="ae-grid" role="group" aria-label={def.title}>
        {def.removable && (
          <button type="button" className={`ae-card ae-none ${!worn ? 'on' : ''}`} aria-pressed={!worn} onClick={() => onRemove(wornItem, def)}>
            <span className="ae-none-box" aria-hidden="true" />
            <span className="ae-card-name">{def.noneLabel ?? 'Nenhum'}</span>
          </button>
        )}
        {shown.map((item) => {
          const acc = accessOf(item, { unlocks, wearing });
          const selected = worn?.ref.id === item.id;
          const blocked = acc !== 'ok';
          const status = acc === 'locked' ? 'Bloqueado' : acc === 'upcoming' ? 'Em breve' : '';
          return (
            <button
              key={item.id}
              type="button"
              className={`ae-card ${selected ? 'on' : ''} ${blocked ? 'locked' : ''}`}
              aria-pressed={selected}
              aria-disabled={blocked || undefined}
              aria-label={`${item.name}${selected ? ', equipado' : ''}${status ? `, ${status.toLowerCase()}` : ''}`}
              title={item.description}
              data-item={item.id}
              onClick={() => {
                if (blocked) {
                  onNotice(acc === 'locked' ? lockedText(item) : `"${item.name}" chega em breve.`);
                  return;
                }
                if (selected && def.removable) onRemove(item, def);
                else onEquip(item);
              }}
            >
              <ItemThumb item={item} color={worn?.ref.color} skin={avatar.skin} />
              <span className="ae-card-name">{item.name}</span>
              {status ? <span className="ae-card-tag">{status}</span> : item.rarity !== 'common' && <span className={`ae-card-tag rar-${item.rarity}`}>{RARITY_LABEL[item.rarity]}</span>}
            </button>
          );
        })}
      </div>
      {wornItem && (
        <div className="ae-detail">
          <p className="ae-desc">
            <b>{wornItem.name}.</b> {wornItem.description}
            {missing.length > 0 && <span className="ae-warn"> Não aparece quando o avatar está {missing.join(' ou ')}.</span>}
          </p>
          {wornItem.palette && colors.length > 0 && <ColorPicker label={`Cor: ${wornItem.name}`} colors={colors} value={worn?.ref.color} onPick={(c) => onColor(wornItem, c)} />}
        </div>
      )}
    </section>
  );
}
