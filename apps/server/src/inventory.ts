import {
  HOST_KINDS,
  MAX_INVENTORY_HOSTS,
  hostLabels,
  rebootJoke,
  simCpu,
  simPingMs,
  type HostKind,
  type HostStatus,
  type InventoryAction,
  type InventoryHost,
  type InventoryResult,
  type ServerMessage,
} from '@workverse/shared';
import type { Player, RoomInstance } from './room';

/**
 * Inventario de PCs da organizacao (so TI e staff veem; ver World.inventoryQuery). Calculado do estado REAL do mundo: cada
 * estacao de trabalho de cada sala vira um host, "online" quando alguem esta sentado trabalhando nela. Funcoes puras sobre as
 * salas de UMA organizacao: nada daqui enxerga outra organizacao.
 */
export interface InventoryContext {
  rooms: ReadonlyMap<string, RoomInstance>;
  /** A pessoa que consulta pode entrar nessa sala? Se nao, o host aparece "em uma sala privada" (sem sala, posicao nem hostname real). */
  canEnter(roomId: string): boolean;
  /** Conta ativa (nao desativada, banida nem suspensa). */
  accountOk(accountId: string): boolean;
  depts: Array<{ id: string; name: string; color: string }>;
  now: number;
}

const hostKey = (roomId: string, furniId: string) => `${roomId}/${furniId}`;

/** Quem esta trabalhando nessa estacao agora: sentado, em atividade `working`, visivel (staff invisivel nao aparece) e de conta ativa. */
function workersOf(room: RoomInstance, furniId: string, ctx: InventoryContext): Player[] {
  const out: Player[] = [];
  for (const p of room.players.values()) {
    if (p.workingAt !== furniId || !p.sitting || p.activity !== 'working' || p.invisible) continue;
    if (!ctx.accountOk(p.accountId)) continue;
    out.push(p);
  }
  return out.sort((a, b) => a.workSince - b.workSince || a.name.localeCompare(b.name, 'pt-BR'));
}

function statusOf(room: RoomInstance, furniId: string, workers: Player[]): HostStatus {
  if (workers.length > 0) return 'online';
  return room.furniState[furniId] === true ? 'idle' : 'off';
}

export function buildInventory(ctx: InventoryContext): InventoryResult {
  const hosts: InventoryHost[] = [];
  const rooms: Array<{ id: string; name: string }> = [];
  const hiddenSeq: Record<string, number> = {};
  for (const [roomId, room] of ctx.rooms) {
    const def = room.built.def;
    const stations = def.furniture.filter((f) => (HOST_KINDS as readonly string[]).includes(f.kind));
    if (stations.length === 0) continue;
    const visible = ctx.canEnter(roomId);
    if (visible) rooms.push({ id: roomId, name: def.name });
    const labels = hostLabels(roomId, stations.map((f) => ({ id: f.id, kind: f.kind as HostKind, x: f.x, y: f.y })));
    const sorted = [...stations].sort((a, b) => (labels.get(a.id)!.hostname < labels.get(b.id)!.hostname ? -1 : 1));
    for (const f of sorted) {
      const workers = workersOf(room, f.id, ctx);
      const status = statusOf(room, f.id, workers);
      const kind = f.kind as HostKind;
      const key = hostKey(roomId, f.id);
      const users = workers.slice(0, 3).map((p) => ({
        name: p.name,
        ...(p.title ? { title: p.title } : {}),
        ...(p.dept ? { dept: p.dept, deptColor: p.deptColor } : {}),
        upMs: Math.max(0, ctx.now - p.workSince),
      }));
      if (visible) {
        const l = labels.get(f.id)!;
        hosts.push({ id: key, hostname: l.hostname, ip: l.ip, kind, roomId, roomName: def.name, x: f.x, y: f.y, status, users, cpu: simCpu(key, ctx.now, status) });
      } else {
        // sala privada para quem consulta: nada que a identifique (nome, posicao, hostname e IP genericos)
        const n = (hiddenSeq[kind] = (hiddenSeq[kind] ?? 0) + 1);
        const id = `oculto-${kind}-${n}`;
        hosts.push({ id, hostname: `${kind === 'computer' ? 'PC' : kind === 'command_desk' ? 'CMD' : 'LAB'}-RES-${String(n).padStart(2, '0')}`, ip: `10.0.0.${Math.min(250, n)}`, kind, hidden: true, status, users, cpu: simCpu(key, ctx.now, status) });
      }
    }
  }
  const truncated = hosts.length > MAX_INVENTORY_HOSTS;
  const list = truncated ? hosts.slice(0, MAX_INVENTORY_HOSTS) : hosts;
  return {
    at: ctx.now,
    hosts: list,
    rooms,
    depts: ctx.depts,
    total: hosts.length,
    powered: hosts.filter((h) => h.status !== 'off').length,
    busy: hosts.filter((h) => h.status === 'online').length,
    truncated,
  };
}

const HOST_ID = /^([A-Za-z0-9_-]{1,32})\/([A-Za-z0-9_-]{1,32})$/;

/** Ping ou reinicio (cosmetico) de um host. Devolve a resposta para quem pediu; o aviso ao sentado sai por `notify`. */
export function runInventoryAction(
  ctx: InventoryContext,
  host: string,
  action: InventoryAction,
  notify: (to: Player, msg: ServerMessage) => void,
): Extract<ServerMessage, { t: 'inventory_action_result' }> {
  const fail = (message: string) => ({ t: 'inventory_action_result' as const, host, action, ok: false, message });
  const m = HOST_ID.exec(host);
  const room = m ? ctx.rooms.get(m[1]!) : undefined;
  const f = room?.built.furniById.get(m?.[2] ?? '');
  // sala inexistente, estacao que nao existe mais ou sala privada para quem pediu: a mesma resposta
  if (!m || !room || !f || !(HOST_KINDS as readonly string[]).includes(f.kind) || !ctx.canEnter(m[1]!)) return fail('Host não encontrado.');
  const stations = room.built.def.furniture.filter((x) => (HOST_KINDS as readonly string[]).includes(x.kind));
  const label = hostLabels(m[1]!, stations.map((x) => ({ id: x.id, kind: x.kind as HostKind, x: x.x, y: x.y }))).get(f.id)!;
  const workers = workersOf(room, f.id, ctx);
  const status = statusOf(room, f.id, workers);
  const key = hostKey(m[1]!, f.id);
  const nonce = Math.floor(ctx.now / 1000);
  if (action === 'ping') {
    if (status === 'off') return { t: 'inventory_action_result', host, action, ok: false, message: `${label.hostname} (${label.ip}): sem resposta. Host desligado.` };
    const ms = simPingMs(key, nonce);
    return { t: 'inventory_action_result', host, action, ok: true, ms, message: `Resposta de ${label.ip}: tempo=${ms}ms TTL=64` };
  }
  if (status === 'off') return fail(`${label.hostname} já está desligado.`);
  for (const p of workers) notify(p, { t: 'chat', id: null, name: '', text: rebootJoke(key, nonce), kind: 'system' });
  return {
    t: 'inventory_action_result',
    host,
    action,
    ok: true,
    message: workers.length > 0 ? `Reinício simulado de ${label.hostname}: ${workers.length === 1 ? 'o usuário recebeu um aviso' : 'os usuários receberam um aviso'}. Ninguém foi desconectado.` : `Reinício simulado de ${label.hostname} (ninguém estava usando).`,
  };
}
