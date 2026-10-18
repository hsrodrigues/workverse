import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR, cloneAvatar, getItem, type AvatarV2, type ClientMessage, type ServerMessage } from '@workverse/shared';
import { World, type Connection } from '../src/world';
import { JsonFileAccountStore, MemoryAccountStore } from '../src/store';
import { applyBootstrapStaff, parseStaffEmails } from '../src/staff';

class FakeConn implements Connection {
  strikes = 0;
  accountId?: string;
  player?: Connection['player'];
  inbox: ServerMessage[] = [];
  closed: number | undefined;
  send(msg: ServerMessage) {
    this.inbox.push(msg);
  }
  close(code?: number) {
    this.closed = code ?? 1000;
  }
  all<T extends ServerMessage['t']>(t: T) {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }
  last<T extends ServerMessage['t']>(t: T) {
    return this.all(t).at(-1);
  }
  text() {
    return this.all('chat').map((m) => m.text);
  }
  errors() {
    return this.all('error').map((m) => m.code);
  }
}

const BOOT = 'helper@x.com:helper,mod@x.com:moderator,adm@x.com';
let now = 5_000_000;
let store: MemoryAccountStore;
let world: World;
let logs: { event: string; data?: Record<string, unknown> }[];
const tick = () => (now += 1000);

function mkWorld(emails = BOOT) {
  logs = [];
  store = new MemoryAccountStore();
  world = new World({ store, allowDevLogin: true, clock: () => now, bootstrapStaffEmails: emails, log: (event, data) => logs.push({ event, data }) });
}

/** Cria a conta (como o cadastro faria) e entra pelo caminho de dev-login. */
function login(name: string, email?: string, room = 'office'): FakeConn {
  if (email && !store.getByName(name)) store.create({ email, displayName: name, passwordHash: '' });
  const c = new FakeConn();
  world.handle(c, { t: 'hello', name });
  world.handle(c, { t: 'join', roomId: room });
  return c;
}
const send = (c: FakeConn, msg: Record<string, unknown>) => {
  tick();
  world.handle(c, msg as ClientMessage);
};
const say = (c: FakeConn, text: string) => send(c, { t: 'chat', text });
const clear = (...cs: FakeConn[]) => cs.forEach((c) => (c.inbox = []));
const audits = (action?: string) => logs.filter((l) => l.event === 'staff.action' && (!action || l.data?.action === action));
const badge = (a: AvatarV2) => a.special.some((r) => r.id === 'sp.badge_staff');
const withLook = (patch: Partial<AvatarV2>): AvatarV2 => ({ ...cloneAvatar(DEFAULT_AVATAR), ...patch });

beforeEach(() => {
  now = 5_000_000;
  mkWorld();
});

describe('concessão de staff: só o servidor', () => {
  it('lista de e-mails aceita nível opcional e ignora lixo', () => {
    const m = parseStaffEmails(' A@x.com:helper; b@x.com , c@x.com:rei, sem-arroba ');
    expect([...m]).toEqual([
      ['a@x.com', 'helper'],
      ['b@x.com', 'admin'],
    ]);
  });

  it('BOOTSTRAP_STAFF_EMAILS: a conta cadastrada vira staff no login e o selo vai para a sala; as outras não', () => {
    const ana = login('Ana', 'ana@x.com');
    const mod = login('Moda', 'mod@x.com');
    expect(store.getByName('Moda')!.staff).toBe('moderator');
    expect(store.getByName('Ana')!.staff).toBeUndefined();
    const joined = ana.all('joined').find((j) => j.player.name === 'Moda')!;
    expect(joined.player.staff).toBe('moderator');
    expect(badge(joined.player.avatar as AvatarV2)).toBe(true);
    expect(mod.all('session')[0]!.staff).toEqual({ level: 'moderator', duty: true, invisible: false });
    expect(ana.all('session')[0]!.staff).toBeUndefined();
    expect(ana.last('room')!.room.players.every((p) => p.staff === undefined)).toBe(true);
  });

  it('applyBootstrapStaff concede às contas existentes na inicialização e nunca revoga', () => {
    const s = new MemoryAccountStore();
    s.create({ email: 'adm@x.com', displayName: 'Adm', passwordHash: 'h' });
    s.create({ email: 'z@x.com', displayName: 'Zed', passwordHash: 'h' });
    expect(applyBootstrapStaff(s, parseStaffEmails('adm@x.com:helper'))).toHaveLength(1);
    expect(s.getByName('Adm')!.staff).toBe('helper');
    expect(applyBootstrapStaff(s, new Map())).toHaveLength(0);
    expect(s.getByName('Adm')!.staff).toBe('helper');
    expect(s.getByName('Zed')!.staff).toBeUndefined();
  });

  it('persiste no arquivo JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wv-staff-'));
    try {
      const file = join(dir, 'a.json');
      const a = new JsonFileAccountStore(file);
      const acc = a.create({ email: 's@x.com', displayName: 'Sam', passwordHash: 'h' });
      acc.staff = 'moderator';
      a.save(acc);
      a.flush();
      expect(new JsonFileAccountStore(file).getByEmail('s@x.com')!.staff).toBe('moderator');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cliente não consegue se promover', () => {
  it('mensagens staff forjadas recebem erro genérico, não mudam nada e são registradas', () => {
    const ana = login('Ana', 'ana@x.com');
    const beto = login('Beto', 'beto@x.com');
    clear(ana, beto);
    const forged: Record<string, unknown>[] = [
      { t: 'staff_duty', on: true },
      { t: 'staff_invis', on: true },
      { t: 'staff_list' },
      { t: 'staff_mute', target: 'Beto', minutes: 5 },
      { t: 'staff_kick', target: 'Beto', scope: 'session' },
      { t: 'staff_goto', target: 'Beto' },
      { t: 'staff_bring', target: 'Beto' },
      { t: 'staff_announce', text: 'oi', scope: 'all' },
      { t: 'staff_item', target: 'Ana', key: 'event:natal', grant: true },
      { t: 'staff_item', target: 'Ana', key: 'staff', grant: true },
      { t: 'staff_mute', target: 42, minutes: 'x' }, // mesmo malformada: recusa genérica
    ];
    for (const m of forged) {
      clear(ana);
      send(ana, m);
      expect(ana.errors(), JSON.stringify(m)).toEqual(['forbidden']);
      expect(ana.all('staff_self')).toHaveLength(0);
      expect(ana.all('staff_online')).toHaveLength(0);
    }
    expect(beto.inbox.filter((m) => m.t === 'announce' || m.t === 'error')).toHaveLength(0);
    expect(store.getByName('Ana')!.staff).toBeUndefined();
    expect(store.getByName('Ana')!.unlocks ?? []).toEqual([]);
    expect(audits()).toHaveLength(0);
    expect(logs.filter((l) => l.event === 'staff.denied').length).toBe(forged.length);
    expect(ana.strikes).toBe(0);
  });

  it('comandos /... de staff viram o chat comum (resposta genérica) para quem não é staff', () => {
    const ana = login('Ana', 'ana@x.com');
    const beto = login('Beto', 'beto@x.com');
    clear(ana, beto);
    for (const t of ['/staff on', '/goto Beto', '/aviso oi todos', '/mute Beto 5', '/dar Ana achievement:coffee-lover', '/kick Beto']) {
      say(ana, t);
      expect(ana.text().at(-1)).toBe('Comandos: /acenar');
    }
    expect(beto.inbox).toHaveLength(0);
    expect(ana.all('staff_self')).toHaveLength(0);
  });

  it('nome, hello e avatar não dão selo: "Staff Admin", campos forjados e crachá no avatar', () => {
    const fake = new FakeConn();
    world.handle(fake, { t: 'hello', name: 'Staff Admin', avatar: withLook({ special: [{ id: 'sp.badge_staff' }] }), staff: 'admin', onDuty: true } as never);
    world.handle(fake, { t: 'join' });
    const obs = login('Obs', 'obs@x.com');
    const p = obs.last('room')!.room.players.find((x) => x.name === 'Staff Admin')!;
    expect(p.staff).toBeUndefined();
    expect(badge(p.avatar as AvatarV2)).toBe(false);
    expect(fake.all('session')[0]!.staff).toBeUndefined();
    expect(badge(fake.all('session')[0]!.avatar as AvatarV2)).toBe(false);
    // tentar equipar depois pelo editor também falha
    send(fake, { t: 'avatar_save', rid: 1, avatar: withLook({ special: [{ id: 'sp.badge_staff' }] }) });
    expect(fake.last('avatar_result')!.ok).toBe(false);
    // nem com a chave 'staff' / item gravada na conta por outros meios (legado)
    store.getByName('Staff Admin')!.unlocks = ['staff', 'item:sp.badge_staff'];
    send(fake, { t: 'avatar_save', rid: 2, avatar: withLook({ special: [{ id: 'sp.badge_staff' }] }) });
    expect(fake.last('avatar_result')!.ok).toBe(false);
    expect(obs.all('avatar')).toHaveLength(0);
  });

  it('crachá legado salvo em conta não-staff é removido ao entrar', () => {
    const acc = store.create({ email: 'old@x.com', displayName: 'Velho', passwordHash: '' });
    acc.avatar = withLook({ special: [{ id: 'sp.badge_staff' }] });
    const c = login('Velho');
    expect(badge(c.all('session')[0]!.avatar as AvatarV2)).toBe(false);
  });
});

describe('crachá dourado e serviço', () => {
  it('em serviço o crachá é imposto pelo servidor (não dá para tirar); fora de serviço some; o selo acompanha', () => {
    const mod = login('Moda', 'mod@x.com');
    const obs = login('Obs', 'obs@x.com');
    clear(mod, obs);
    // tenta tirar o crachá salvando um visual sem ele
    send(mod, { t: 'avatar_save', avatar: withLook({}) });
    expect(mod.last('avatar_result')!.ok).toBe(true);
    expect(badge(obs.last('avatar')!.avatar as AvatarV2)).toBe(true);
    // sai de serviço
    clear(mod, obs);
    say(mod, '/staff off');
    expect(mod.last('staff_self')).toMatchObject({ duty: false });
    expect(obs.last('staff_flag')).toMatchObject({ staff: null });
    expect(badge(obs.last('avatar')!.avatar as AvatarV2)).toBe(false);
    // fora de serviço, os poderes ficam bloqueados
    clear(mod, obs);
    say(mod, '/aviso olá');
    expect(mod.errors()).toEqual(['off_duty']);
    expect(obs.all('announce')).toHaveLength(0);
    // volta
    say(mod, '/staff on');
    expect(obs.last('staff_flag')).toMatchObject({ staff: 'moderator' });
    expect(badge(obs.last('avatar')!.avatar as AvatarV2)).toBe(true);
    expect(audits('duty.off')).toHaveLength(1);
    expect(audits('duty.on')).toHaveLength(1);
  });

  it('o item do crachá existe no catálogo, é de desbloqueio staff e tem o desenho dourado', () => {
    const item = getItem('sp.badge_staff')!;
    expect(item.unlock).toBe('staff');
    expect(item.params?.staff).toBe(true);
  });
});

describe('poderes', () => {
  it('silenciar bloqueia chat, DM e equipe até acabar; tem teto por nível; remover funciona', () => {
    const helper = login('Ajuda', 'helper@x.com');
    const mod = login('Moda', 'mod@x.com');
    const beto = login('Beto', 'beto@x.com');
    const cris = login('Cris', 'cris@x.com');
    clear(helper, beto, cris);
    say(helper, '/mute Beto 60');
    expect(helper.text().at(-1)).toMatch(/até 30 min/);
    say(helper, '/mute Beto 10 spam de links');
    expect(beto.errors()).toEqual(['muted']);
    clear(beto, cris);
    say(beto, 'oi pessoal');
    send(beto, { t: 'dm', to: 'Cris', text: 'psiu' });
    send(beto, { t: 'team', text: 'time' });
    expect(beto.errors()).toEqual(['muted', 'muted', 'muted']);
    expect(cris.inbox).toHaveLength(0);
    // expira
    now += 11 * 60_000;
    clear(beto, cris);
    say(beto, 'voltei');
    expect(cris.all('chat').some((m) => m.text === 'voltei')).toBe(true);
    // moderador silencia por mais tempo e remove
    say(mod, '/mute Beto 120');
    clear(beto);
    say(beto, 'x');
    expect(beto.errors()).toEqual(['muted']);
    say(mod, '/unmute Beto');
    clear(beto, cris);
    say(beto, 'livre');
    expect(cris.all('chat').some((m) => m.text === 'livre')).toBe(true);
    expect(audits('mute').map((a) => a.data?.detail)).toEqual(['10min; spam de links', '120min']);
    expect(audits('unmute')).toHaveLength(1);
  });

  it('o silenciamento sobrevive a reconectar', () => {
    const mod = login('Moda', 'mod@x.com');
    login('Beto', 'beto@x.com');
    say(mod, '/mute Beto 30');
    const again = new FakeConn();
    world.handle(again, { t: 'hello', name: 'Beto' });
    world.handle(again, { t: 'join' });
    clear(again);
    say(again, 'oi');
    expect(again.errors()).toEqual(['muted']);
  });

  it('expulsar da sala manda para a sala inicial; expulsar da sessão encerra (moderador+) e avisa o motivo', () => {
    const helper = login('Ajuda', 'helper@x.com');
    const mod = login('Moda', 'mod@x.com');
    const beto = login('Beto', 'beto@x.com', 'lounge');
    clear(beto);
    say(helper, '/kick Beto');
    expect(helper.errors()).toContain('forbidden'); // ajudante não expulsa da sessão
    expect(beto.closed).toBeUndefined();
    say(helper, '/kickroom Beto fora daqui');
    expect(beto.errors()).toContain('kicked_room');
    expect(beto.last('room')!.room.def.id).toBe('office');
    say(mod, '/kick Beto saiu da linha');
    expect(beto.closed).toBe(4005);
    expect(beto.all('error').find((e) => e.code === 'kicked')!.message).toMatch(/saiu da linha/);
    expect(world.onlineCount).toBe(2);
    expect(audits('kick.room')).toHaveLength(1);
    expect(audits('kick.session')[0]!.data).toMatchObject({ actorName: 'Moda', targetName: 'Beto', detail: 'saiu da linha' });
  });

  it('goto e bring teleportam dentro da mesma organização, entre salas', () => {
    const helper = login('Ajuda', 'helper@x.com', 'office');
    const beto = login('Beto', 'beto@x.com', 'lounge');
    say(helper, '/goto Beto');
    expect(helper.player!.roomId).toBe('lounge');
    expect(Math.abs(helper.player!.x - beto.player!.x) + Math.abs(helper.player!.y - beto.player!.y)).toBeLessThanOrEqual(3);
    say(helper, '/bring Beto'); // já juntos: não quebra
    const cris = login('Cris', 'cris@x.com', 'reception');
    say(helper, '/bring Cris');
    expect(cris.player!.roomId).toBe('lounge');
    expect(audits('goto')).toHaveLength(1);
    expect(audits('bring').map((a) => a.data?.targetName)).toContain('Cris');
    // não-staff com o mesmo comando não move ninguém
    const dee = login('Dee', 'dee@x.com', 'focus');
    say(dee, '/goto Beto');
    say(dee, '/bring Cris');
    expect(dee.player!.roomId).toBe('focus');
    expect(cris.player!.roomId).toBe('lounge');
  });

  it('aviso para a sala (ajudante) e para TODOS (moderador+), com texto limpo', () => {
    const helper = login('Ajuda', 'helper@x.com', 'office');
    const mod = login('Moda', 'mod@x.com', 'office');
    const beto = login('Beto', 'beto@x.com', 'office');
    const cris = login('Cris', 'cris@x.com', 'lounge');
    clear(helper, mod, beto, cris);
    say(helper, '/avisosala manutenção às 18h');
    expect(beto.last('announce')).toMatchObject({ scope: 'room', from: 'Ajuda', level: 'helper', text: 'manutenção às 18h' });
    expect(cris.all('announce')).toHaveLength(0);
    say(helper, '/aviso olá a todos');
    expect(helper.errors()).toContain('forbidden');
    expect(cris.all('announce')).toHaveLength(0);
    send(mod, { t: 'staff_announce', scope: 'all', text: 'Reinício‮ em 5 min   ok' });
    for (const c of [beto, cris, helper]) expect(c.last('announce')).toMatchObject({ scope: 'all', from: 'Moda', level: 'moderator', text: 'Reinício em 5 min ok' });
    expect(audits('announce.all')).toHaveLength(1);
  });

  it('conceder/revogar itens: só admin; chave staff é recusada; funciona com o editor', () => {
    const mod = login('Moda', 'mod@x.com');
    const adm = login('Adm', 'adm@x.com');
    const beto = login('Beto', 'beto@x.com');
    say(mod, '/dar Beto achievement:coffee-lover');
    expect(mod.errors()).toContain('forbidden');
    expect(store.getByName('Beto')!.unlocks ?? []).toEqual([]);
    say(adm, '/dar Beto achievement:coffee-lover');
    expect(store.getByName('Beto')!.unlocks).toEqual(['achievement:coffee-lover']);
    send(beto, { t: 'avatar_save', avatar: withLook({ special: [{ id: 'sp.mug_gold' }] }) });
    expect(beto.last('avatar_result')!.ok).toBe(true);
    clear(adm);
    say(adm, '/dar Beto staff');
    say(adm, '/dar Beto item:sp.badge_staff');
    expect(adm.text().filter((t) => /só é liberado pelo servidor/.test(t))).toHaveLength(2);
    expect(store.getByName('Beto')!.unlocks).toEqual(['achievement:coffee-lover']);
    say(adm, '/tirar Beto achievement:coffee-lover');
    expect(store.getByName('Beto')!.unlocks).toEqual([]);
    expect(audits('item.grant')[0]!.data).toMatchObject({ actorName: 'Adm', targetName: 'Beto', detail: 'achievement:coffee-lover' });
    expect(audits('item.revoke')).toHaveLength(1);
  });

  it('lista de online só para staff (com sala e org) e nunca traz DMs', () => {
    const helper = login('Ajuda', 'helper@x.com');
    const beto = login('Beto', 'beto@x.com', 'lounge');
    send(beto, { t: 'dm', to: 'Ajuda', text: 'segredo' });
    clear(helper);
    send(helper, { t: 'staff_list' });
    const list = helper.last('staff_online')!;
    expect(list.players.map((p) => p.name).sort()).toEqual(['Ajuda', 'Beto']);
    expect(list.players.find((p) => p.name === 'Beto')).toMatchObject({ roomId: 'lounge', orgId: 'default', muted: false, invisible: false });
    expect(JSON.stringify(helper.inbox.filter((m) => m.t.startsWith('staff_')))).not.toContain('segredo');
    clear(beto);
    send(beto, { t: 'staff_list' });
    expect(beto.all('staff_online')).toHaveLength(0);
  });

  it('invisível: some para os outros, não aparece no snapshot, continua com poderes; reaparece', () => {
    const mod = login('Moda', 'mod@x.com');
    const beto = login('Beto', 'beto@x.com');
    clear(mod, beto);
    say(mod, '/invis on');
    expect(beto.all('left').map((l) => l.id)).toEqual([mod.player!.id]);
    clear(beto);
    say(mod, 'estou aqui?');
    expect(beto.inbox).toHaveLength(0);
    expect(mod.text().at(-1)).toMatch(/invisível/);
    send(mod, { t: 'move', x: mod.player!.x + 1, y: mod.player!.y });
    expect(beto.all('path')).toHaveLength(0);
    const cris = login('Cris', 'cris@x.com');
    expect(cris.last('room')!.room.players.map((p) => p.name)).not.toContain('Moda');
    expect(cris.all('joined')).toHaveLength(0);
    // poder continua: o aviso chega
    say(mod, '/avisosala teste');
    expect(beto.all('announce')).toHaveLength(1);
    // staff também enxerga o invisível na lista
    send(mod, { t: 'staff_list' });
    expect(mod.last('staff_online')!.players.find((p) => p.name === 'Moda')!.invisible).toBe(true);
    clear(beto);
    say(mod, '/invis off');
    expect(beto.last('joined')!.player.name).toBe('Moda');
    expect(audits('invis.on')).toHaveLength(1);
  });

  it('hierarquia: não age sobre si mesmo nem sobre staff de nível igual ou maior', () => {
    const helper = login('Ajuda', 'helper@x.com');
    const mod = login('Moda', 'mod@x.com');
    const adm = login('Adm', 'adm@x.com');
    clear(helper, mod, adm);
    say(helper, '/mute Moda 5');
    say(mod, '/kick Adm');
    say(mod, '/mute Moda 5');
    expect(helper.errors()).toEqual(['forbidden']);
    expect(mod.errors()).toEqual(['forbidden']);
    expect(adm.errors()).toEqual([]);
    expect(adm.closed).toBeUndefined();
    expect(audits('mute')).toHaveLength(0);
    // moderador pode agir sobre ajudante
    say(mod, '/mute Ajuda 5');
    expect(audits('mute')).toHaveLength(1);
  });

  it('limite de taxa nas ações de staff', () => {
    const helper = login('Ajuda', 'helper@x.com');
    clear(helper);
    for (let i = 0; i < 30; i++) world.handle(helper, { t: 'staff_list' }); // sem avançar o relógio
    expect(helper.errors()).toContain('rate_limited');
  });

  it('mensagem malformada de staff conta strike; alvo inexistente só responde no chat', () => {
    const helper = login('Ajuda', 'helper@x.com');
    send(helper, { t: 'staff_mute', target: 'Beto', minutes: -5 });
    send(helper, { t: 'staff_kick', target: 'Beto', scope: 'galaxy' });
    send(helper, { t: 'staff_announce', text: 7, scope: 'room' });
    expect(helper.strikes).toBe(3);
    clear(helper);
    say(helper, '/goto Fantasma');
    expect(helper.text().at(-1)).toMatch(/não encontrado/);
  });

  it('revogar a conta no meio da sessão derruba poderes e selo na próxima ação', () => {
    const mod = login('Moda', 'mod@x.com');
    const obs = login('Obs', 'obs@x.com');
    delete store.getByName('Moda')!.staff; // o que o servidor faria ao revogar (o mapa de bootstrap só é lido no hello)
    clear(mod, obs);
    say(mod, '/aviso oi'); // sem staff: vira comando desconhecido
    expect(obs.all('announce')).toHaveLength(0);
    send(mod, { t: 'staff_list' });
    expect(mod.errors()).toContain('forbidden');
    expect(obs.last('staff_flag')).toMatchObject({ staff: null });
  });
});
