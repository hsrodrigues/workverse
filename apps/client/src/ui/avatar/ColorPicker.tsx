import type { PaletteColor } from '@workverse/shared';

interface Props {
  label: string;
  colors: readonly PaletteColor[];
  value: string | undefined;
  onPick(id: string): void;
}

/** Palette swatches, grouped by color family when the palette is large (hair: preto, castanho, loiro, ruivo, grisalho, fantasia). */
export function ColorPicker({ label, colors, value, onPick }: Props) {
  const groups: { name: string; colors: PaletteColor[] }[] = [];
  for (const c of colors) {
    let g = groups.find((x) => x.name === c.group);
    if (!g) groups.push((g = { name: c.group, colors: [] }));
    g.colors.push(c);
  }
  const grouped = colors.length > 12 && groups.length > 1;
  const current = colors.find((c) => c.id === value);
  const swatch = (c: PaletteColor) => (
    <button
      key={c.id}
      type="button"
      className={`ae-swatch ${c.id === value ? 'on' : ''}`}
      style={{ background: c.hex }}
      aria-label={c.name}
      aria-pressed={c.id === value}
      title={c.name}
      onClick={() => onPick(c.id)}
    />
  );
  return (
    <div className="ae-colors" role="group" aria-label={label}>
      <div className="ae-colors-head">
        <span>{label}</span>
        <b>{current?.name ?? ''}</b>
      </div>
      {grouped ? (
        <div className="ae-color-groups">
          {groups.map((g) => (
            <div key={g.name} className="ae-color-group">
              <span className="ae-color-group-name">{g.name}</span>
              <div className="ae-swatches">{g.colors.map(swatch)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="ae-swatches">{colors.map(swatch)}</div>
      )}
    </div>
  );
}
