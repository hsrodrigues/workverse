import type { FurniKind } from './rooms';

/**
 * Inventario de PCs conectados no escritorio (terminal retro dos servidores da Sala da TI). Contrato das mensagens e funcoes
 * PURAS (hostname e IP fictícios estaveis, carga de CPU e latencia simuladas) usadas pelo servidor e pelos testes. O estado vem do
 * mundo real: cada estacao de trabalho (`computer`, `command_desk`, `hardware_bench`) da organizacao e um host; "online" e quem
 * esta sentado trabalhando nela agora.
 */

export type HostStatus = 'online' | 'idle' | 'off';
export type HostKind = Extract<FurniKind, 'computer' | 'command_desk' | 'hardware_bench'>;
export const HOST_KINDS: readonly HostKind[] = ['computer', 'command_desk', 'hardware_bench'];

export interface HostUser {
  name: string;
  title?: string;
  dept?: string;
  deptColor?: string;
  /** Ha quanto tempo a pessoa trabalha nessa estacao, em ms (medido pelo servidor). */
  upMs: number;
}

export interface InventoryHost {
  /** Opaco para o cliente: `sala/peca`, ou `oculto-N` quando a sala e privada para quem consulta. */
  id: string;
  hostname: string;
  ip: string;
  kind: HostKind;
  /** Ausentes quando a sala e privada/restrita para quem consulta (`hidden`): a UI diz "em uma sala privada". */
  roomId?: string;
  roomName?: string;
  hidden?: boolean;
  x?: number;
  y?: number;
  status: HostStatus;
  users: HostUser[];
  /** Carga de CPU simulada, 0 a 100. */
  cpu: number;
}

export interface InventoryResult {
  at: number;
  hosts: InventoryHost[];
  /** Salas da organizacao que quem consulta enxerga (para o filtro). */
  rooms: Array<{ id: string; name: string }>;
  depts: Array<{ id: string; name: string; color: string }>;
  /** Total de estacoes, ligadas (online + ociosas) e com gente trabalhando. */
  total: number;
  powered: number;
  busy: number;
  /** Havia mais estacoes do que cabem na resposta. */
  truncated: boolean;
}

export type InventoryAction = 'ping' | 'reboot';
export const INVENTORY_ACTIONS: readonly InventoryAction[] = ['ping', 'reboot'];
export const isInventoryAction = (v: unknown): v is InventoryAction => typeof v === 'string' && (INVENTORY_ACTIONS as readonly string[]).includes(v);
export const MAX_INVENTORY_HOSTS = 300;
export const MAX_HOST_ID_LENGTH = 80;
export const IT_ONLY_MESSAGE = 'Acesso restrito à equipe de TI.';

/** Codigo curto de cada sala no hostname (`PC-ESC-03`). Salas sem codigo usam as 3 primeiras letras do id. */
export const ROOM_CODES: Readonly<Record<string, string>> = {
  office: 'ESC',
  lounge: 'COP',
  auditorium: 'AUD',
  reception: 'REC',
  team: 'EQP',
  meeting1: 'RE1',
  meeting2: 'RE2',
  private: 'PRV',
  focus: 'FOC',
  ti: 'TI',
};
export const roomCode = (roomId: string): string => ROOM_CODES[roomId] ?? (roomId.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'SLA');

const KIND_PREFIX: Readonly<Record<HostKind, string>> = { computer: 'PC', command_desk: 'CMD', hardware_bench: 'LAB' };
const KIND_OCTET: Readonly<Record<HostKind, number>> = { computer: 10, command_desk: 110, hardware_bench: 170 };

/** Hash de texto estavel (FNV-1a), 0..2^32-1. */
export function hashText(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const unit = (s: string): number => hashText(s) / 4294967296;

export interface Station {
  id: string;
  kind: HostKind;
  x: number;
  y: number;
}

/**
 * Hostname e IP fictícios das estacoes de uma sala. Estaveis: dependem so da sala e da posicao (ordenadas por linha e coluna),
 * nunca do id da peca. O numero conta dentro de cada tipo (`PC-ESC-03`, `CMD-TI-01`); o IP e `10.<rede da sala>.<y+1>.<base do tipo + x>`.
 */
export function hostLabels(roomId: string, stations: readonly Station[]): Map<string, { hostname: string; ip: string }> {
  const out = new Map<string, { hostname: string; ip: string }>();
  const sorted = [...stations].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const seq: Record<string, number> = {};
  const net = 20 + (hashText(`rede:${roomId}`) % 200);
  for (const s of sorted) {
    const n = (seq[s.kind] = (seq[s.kind] ?? 0) + 1);
    out.set(s.id, {
      hostname: `${KIND_PREFIX[s.kind]}-${roomCode(roomId)}-${String(n).padStart(2, '0')}`,
      ip: `10.${net}.${Math.min(250, s.y + 1)}.${Math.min(250, KIND_OCTET[s.kind] + s.x)}`,
    });
  }
  return out;
}

/** Carga de CPU simulada: estavel por host e janela de 15 s. Ocupado 25..92, ligado sem uso 2..9, desligado 0. */
export function simCpu(hostKey: string, now: number, status: HostStatus): number {
  if (status === 'off') return 0;
  const bucket = Math.floor(now / 15_000);
  const r = unit(`cpu:${hostKey}:${bucket}`);
  const base = unit(`cpu-base:${hostKey}`);
  if (status === 'idle') return 2 + Math.floor(r * 8);
  return Math.min(92, 25 + Math.floor(base * 35 + r * 32));
}

/** Latencia de ping fictícia em ms: 1..9 na rede local, de forma estavel por host e tentativa. */
export function simPingMs(hostKey: string, nonce: number): number {
  return 1 + Math.floor(unit(`ping:${hostKey}:${nonce}`) * 8);
}

/** "2h 05m", "14m", "35s": ha quanto tempo a pessoa esta na estacao. */
export function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Avisos engracados que a pessoa sentada recebe quando a TI "reinicia" o PC dela (so cosmetico, ninguem e derrubado). */
export const REBOOT_JOKES: readonly string[] = [
  'A TI está reiniciando o seu PC... brincadeira! Nada foi derrubado. ☕',
  'Atenção: a TI tentou desligar e ligar de novo. O seu PC respondeu: "já tentou reiniciar você?"',
  'Reiniciando o PC... 99%... pronto! Era só um susto do servidor da TI.',
  'A TI sussurrou "desliga e liga" no seu PC, mas ele recusou. Continue trabalhando!',
];
export const rebootJoke = (hostKey: string, nonce: number): string => REBOOT_JOKES[hashText(`joke:${hostKey}:${nonce}`) % REBOOT_JOKES.length]!;
