import { useSyncExternalStore } from 'react';
import { activeEvents, getEventDef, isEventId, type EventDef, type EventsView } from '@workverse/shared';
import { net } from './net';

/**
 * Eventos ativos no cliente. Fonte: o servidor (mensagem `events`, igual para todos); sem ela (login, offline) vale a data
 * do PC. `?event=halloween` (ou lista `a,b`) na URL forca eventos para teste. A pessoa pode desligar a decoracao
 * (localStorage `wv.eventDecor`=`off`). Nada aqui e seguranca: os itens de evento sao liberados pelo servidor.
 */
let server: EventsView | null = null;
let version = 0;
const listeners = new Set<() => void>();
const bump = () => {
  version++;
  listeners.forEach((l) => l());
};

function devOverride(): EventDef[] | null {
  try {
    const q = new URLSearchParams(location.search).get('event');
    if (!q) return null;
    return q
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(isEventId)
      .map((id) => getEventDef(id)!);
  } catch {
    return null;
  }
}

export function decorEnabled(): boolean {
  try {
    return localStorage.getItem('wv.eventDecor') !== 'off';
  } catch {
    return true;
  }
}

export function setDecorEnabled(on: boolean) {
  try {
    localStorage.setItem('wv.eventDecor', on ? 'on' : 'off');
  } catch {
    /* sem armazenamento: vale so ate recarregar */
  }
  prefOff = !on;
  bump();
}
let prefOff = !decorEnabled();

/** Eventos ativos (maior prioridade primeiro), ja sem os desligados pela pessoa. */
export function currentEvents(): EventDef[] {
  const dev = devOverride();
  if (dev) return dev;
  if (prefOff) return [];
  return server ? (server.active.map((id) => getEventDef(id)).filter(Boolean) as EventDef[]) : activeEvents(new Date());
}

/** Eventos ativos ignorando a preferencia da pessoa (para o painel e o menu). */
export function rawEvents(): EventDef[] {
  return server ? (server.active.map((id) => getEventDef(id)).filter(Boolean) as EventDef[]) : activeEvents(new Date());
}

export const serverEvents = (): EventsView | null => server;
export const isDecorOff = () => prefOff;

net.on((m) => {
  if (m.t === 'events') {
    server = { active: m.active, forced: m.forced, disabled: m.disabled };
    bump();
  }
});

export function onEventsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useEventsVersion(): number {
  return useSyncExternalStore(onEventsChange, () => version);
}
