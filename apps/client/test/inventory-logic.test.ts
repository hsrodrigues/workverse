import { describe, expect, it } from 'vitest';
import type { InventoryHost } from '@workverse/shared';
import { HIDDEN_ROOM, countByRoom, cpuBar, filterHosts, whereText } from '../src/ui/inventory/inventoryLogic';

const host = (over: Partial<InventoryHost>): InventoryHost => ({ id: 'office/a', hostname: 'PC-ESC-01', ip: '10.131.4.12', kind: 'computer', roomId: 'office', roomName: 'Escritório', status: 'off', users: [], cpu: 0, ...over });
const hosts: InventoryHost[] = [
  host({ id: 'office/a', status: 'online', users: [{ name: 'João Álvares', dept: 'TI', title: 'Dev', upMs: 1000 }], cpu: 50 }),
  host({ id: 'office/b', hostname: 'PC-ESC-02', ip: '10.131.4.13', status: 'idle' }),
  host({ id: 'ti/c', hostname: 'CMD-TI-01', ip: '10.50.4.110', roomId: 'ti', roomName: 'Sala da TI', status: 'online', users: [{ name: 'Maria', dept: 'Financeiro', upMs: 5 }] }),
  host({ id: 'oculto-computer-1', hostname: 'PC-RES-01', ip: '10.0.0.1', roomId: undefined, roomName: undefined, hidden: true }),
];

describe('painel do inventário: filtros e contadores', () => {
  it('busca por nome (sem acento), hostname e IP', () => {
    expect(filterHosts(hosts, { room: '', dept: '', q: 'joao alvares' }).map((h) => h.id)).toEqual(['office/a']);
    expect(filterHosts(hosts, { room: '', dept: '', q: 'cmd-ti' }).map((h) => h.id)).toEqual(['ti/c']);
    expect(filterHosts(hosts, { room: '', dept: '', q: '4.13' }).map((h) => h.id)).toEqual(['office/b']);
    expect(filterHosts(hosts, { room: '', dept: '', q: '' })).toHaveLength(4);
  });

  it('filtra por sala (inclusive as privadas) e por setor', () => {
    expect(filterHosts(hosts, { room: 'ti', dept: '', q: '' }).map((h) => h.id)).toEqual(['ti/c']);
    expect(filterHosts(hosts, { room: HIDDEN_ROOM, dept: '', q: '' }).map((h) => h.id)).toEqual(['oculto-computer-1']);
    expect(filterHosts(hosts, { room: '', dept: 'financeiro', q: '' }).map((h) => h.id)).toEqual(['ti/c']);
    expect(filterHosts(hosts, { room: 'office', dept: 'TI', q: 'dev' }).map((h) => h.id)).toEqual(['office/a']);
  });

  it('contadores por sala: ligados (online + ocioso) / total', () => {
    const c = countByRoom(hosts);
    expect(c.get('office')).toEqual({ total: 2, powered: 2, busy: 1 });
    expect(c.get('ti')).toEqual({ total: 1, powered: 1, busy: 1 });
    expect(c.get(HIDDEN_ROOM)).toEqual({ total: 1, powered: 0, busy: 0 });
  });

  it('texto: barra de CPU e "em uma sala privada"', () => {
    expect(cpuBar(50)).toBe('█████░░░░░');
    expect(cpuBar(0)).toBe('░░░░░░░░░░');
    expect(cpuBar(250)).toBe('██████████');
    expect(whereText(hosts[3]!)).toBe('em uma sala privada');
    expect(whereText(hosts[0]!)).toBe('Escritório');
  });
});
