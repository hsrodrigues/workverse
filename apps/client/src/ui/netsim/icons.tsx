import type { DeviceKind } from '@workverse/shared';

/** Icones pixel art ORIGINAIS (12x12) dos equipamentos. Cada letra e uma cor da paleta; '.' e transparente. */
const PALETTE: Record<string, string> = {
  k: '#1b2230',
  w: '#e8eef7',
  g: '#9aa7ba',
  b: '#4f8cff',
  G: '#3fb67a',
  r: '#e5484d',
  y: '#ffd24a',
  o: '#f0883e',
  c: '#5fd0e8',
};

const ART: Record<DeviceKind, string[]> = {
  pc: ['', '.kkkkkkkkkk.', '.kbbbbbbbbk.', '.kbcccbbbbk.', '.kbbbbbbbbk.', '.kbbbbbbbbk.', '.kkkkkkkkkk.', '....kggk....', '....kggk....', '..kkkkkkkk..', '..kggggggk..', '..kkkkkkkk..'],
  laptop: ['', '', '..kkkkkkkk..', '..kbbbbbbk..', '..kbcccbbk..', '..kbbbbbbk..', '..kbbbbbbk..', '..kkkkkkkk..', '.kkkkkkkkkk.', '.kggggggggk.', '.kkkkkkkkkk.'],
  server: ['.kkkkkkkkkk.', '.kggggggggk.', '.kgGggggyyk.', '.kkkkkkkkkk.', '.kggggggggk.', '.kgGggggyyk.', '.kkkkkkkkkk.', '.kggggggggk.', '.kgGggggyyk.', '.kkkkkkkkkk.', '..k......k..', '..kk....kk..'],
  switch: ['', '', '', 'kkkkkkkkkkkk', 'kbbbbbbbbbbk', 'kbwbwbwbwbwk', 'kbbbbbbbbbbk', 'kkkkkkkkkkkk', '.G.G.G.G.G..', '', '', ''],
  router: ['', '.....kk.....', '..k..kk..k..', '.kok.kk.kok.', '.kkkkkkkkkk.', 'kooooooooook', 'kowowowowowk', 'kooooooooook', '.kkkkkkkkkk.', '..G.G.G.G...', '', ''],
  firewall: ['kkkkkkkkkkkk', 'koorooroorok', 'kkkkkkkkkkkk', 'korooroorook', 'kkkkkkkkkkkk', 'koorooroorok', 'kkkkkkkkkkkk', 'korooroorook', 'kkkkkkkkkkkk', '', '', ''],
  ap: ['.....kk.....', '...c.kk.c...', '..c..kk..c..', '...c.kk.c...', '.....kk.....', '..kkkkkkkk..', '..kwwwwwwk..', '..kwGwwwwk..', '..kkkkkkkk..', '', '', ''],
  internet: ['', '....kkkk....', '..kkwwwwkk..', '.kwwwwwwwwk.', 'kwwwwcwwwwwk', 'kwwwwwwwwwwk', '.kwwwwwwwwk.', '..kkkkkkkk..', '', '', '', ''],
  printer: ['', '...kkkkkk...', '...kwwwwk...', '.kkkkkkkkkk.', '.kggggggggk.', '.kggggggyyk.', '.kkkkkkkkkk.', '...kwwwwk...', '...kwwwwk...', '...kkkkkk...', '', ''],
};

const PX = 3;

function Pixels({ kind }: { kind: DeviceKind }) {
  return (
    <g shapeRendering="crispEdges">
      {ART[kind].flatMap((row, y) =>
        [...row.padEnd(12, '.').slice(0, 12)].map((ch, x) => (PALETTE[ch] ? <rect key={`${x},${y}`} x={x * PX} y={y * PX} width={PX} height={PX} fill={PALETTE[ch]} /> : null)),
      )}
    </g>
  );
}

/** Define os simbolos uma vez no SVG do canvas: `<use href="#nsi-pc">`. */
export function IconDefs() {
  return (
    <defs>
      {(Object.keys(ART) as DeviceKind[]).map((kind) => (
        <g id={`nsi-${kind}`} key={kind}>
          <Pixels kind={kind} />
        </g>
      ))}
    </defs>
  );
}

export const ICON_SIZE = 12 * PX;

/** Icone solto (paleta e botoes), com seu proprio SVG. */
export function DeviceIcon({ kind, size = 24 }: { kind: DeviceKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${ICON_SIZE} ${ICON_SIZE}`} aria-hidden="true" focusable="false">
      <Pixels kind={kind} />
    </svg>
  );
}
