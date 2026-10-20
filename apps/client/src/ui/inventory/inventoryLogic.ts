import { foldText, type HostStatus, type InventoryHost } from '@workverse/shared';

/** Logica pura do painel "Servidores · Inventario de PCs" (filtros, contadores, texto): testada sem React. */

export const HIDDEN_ROOM = '__oculta__';

export interface InventoryFilter {
  /** Id da sala, HIDDEN_ROOM para as salas privadas, ou '' para todas. */
  room: string;
  /** Nome do setor ('' = todos): so aparecem PCs em que alguem desse setor esta trabalhando. */
  dept: string;
  /** Busca por nome da pessoa, hostname ou IP (sem acento nem caixa). */
  q: string;
}

export const roomKeyOf = (h: InventoryHost): string => (h.hidden || !h.roomId ? HIDDEN_ROOM : h.roomId);

export function filterHosts(hosts: readonly InventoryHost[], f: InventoryFilter): InventoryHost[] {
  const needle = foldText(f.q);
  const dept = foldText(f.dept);
  return hosts.filter((h) => {
    if (f.room && roomKeyOf(h) !== f.room) return false;
    if (dept && !h.users.some((u) => foldText(u.dept ?? '') === dept)) return false;
    if (needle) {
      const hay = foldText([h.hostname, h.ip, ...h.users.flatMap((u) => [u.name, u.title ?? '', u.dept ?? ''])].join(' '));
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export interface RoomCount {
  total: number;
  powered: number;
  busy: number;
}

/** Contadores por sala (ligados / total) para o filtro e o cabecalho. Salas privadas contam juntas. */
export function countByRoom(hosts: readonly InventoryHost[]): Map<string, RoomCount> {
  const out = new Map<string, RoomCount>();
  for (const h of hosts) {
    const k = roomKeyOf(h);
    const c = out.get(k) ?? { total: 0, powered: 0, busy: 0 };
    c.total++;
    if (h.status !== 'off') c.powered++;
    if (h.status === 'online') c.busy++;
    out.set(k, c);
  }
  return out;
}

export const STATUS_TEXT: Readonly<Record<HostStatus, string>> = { online: 'ONLINE', idle: 'OCIOSO', off: 'DESLIGADO' };
export const STATUS_GLYPH: Readonly<Record<HostStatus, string>> = { online: '●', idle: '◐', off: '○' };

/** Barra de CPU em caracteres: `█████░░░░░ 52%`. */
export function cpuBar(cpu: number, cells = 10): string {
  const n = Math.max(0, Math.min(cells, Math.round((Math.max(0, Math.min(100, cpu)) / 100) * cells)));
  return `${'█'.repeat(n)}${'░'.repeat(cells - n)}`;
}

/** Onde o PC esta, para o texto da linha: a sala, ou "em uma sala privada" quando quem consulta nao pode ver qual. */
export const whereText = (h: InventoryHost): string => (h.hidden ? 'em uma sala privada' : (h.roomName ?? ''));

/** Linha de "ping" no estilo do terminal. */
export const pingLine = (ip: string, ms: number): string => `64 bytes de ${ip}: tempo=${ms}ms TTL=64`;
