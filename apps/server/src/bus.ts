import { Redis, type RedisOptions } from 'ioredis';

/**
 * Barramento de presenca/eventos entre instancias. AINDA NAO esta ligado ao World.
 *
 * Importante: a simulacao de UMA sala continua em UMA instancia (afinidade de sala). O barramento serve
 * para o que atravessa instancias: saber quem esta online e em que sala (presenca), e avisos entre
 * salas/organizacoes (convites, notificacoes, mensagens diretas), nunca para sincronizar o estado de
 * movimento de uma mesma sala entre dois processos.
 */
export type BusHandler = (message: string, channel: string) => void;
export type Unsubscribe = () => void | Promise<void>;

export interface PresenceEntry {
  accountId: string;
  roomId: string;
}

export interface PresenceBus {
  /** Entrega a mensagem a todos os assinantes do canal (inclusive nesta instancia). */
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: BusHandler): Promise<Unsubscribe>;

  /**
   * Marca a conta como presente na sala. A presenca expira em `ttlMs` se nao for renovada
   * (chame de novo periodicamente): evita "fantasmas" quando uma instancia cai sem fazer leave.
   */
  setPresence(accountId: string, roomId: string, ttlMs: number): Promise<void>;
  clearPresence(accountId: string): Promise<void>;
  getPresence(accountId: string): Promise<string | null>;
  listRoom(roomId: string): Promise<string[]>;
  /** Contagem de contas presentes por sala (somente salas com alguem). */
  roomCounts(): Promise<Record<string, number>>;

  close(): Promise<void>;
}

const DEFAULT_PREFIX = 'wv:';

// ---------------------------------------------------------------------------------------------

export class MemoryBus implements PresenceBus {
  private subs = new Map<string, Set<BusHandler>>();
  private presence = new Map<string, { roomId: string; expiresAt: number }>();

  constructor(private readonly clock: () => number = Date.now) {}

  async publish(channel: string, message: string): Promise<void> {
    for (const h of [...(this.subs.get(channel) ?? [])]) {
      try {
        h(message, channel);
      } catch {
        /* um assinante com erro nao pode afetar os outros */
      }
    }
  }

  async subscribe(channel: string, handler: BusHandler): Promise<Unsubscribe> {
    let set = this.subs.get(channel);
    if (!set) this.subs.set(channel, (set = new Set()));
    set.add(handler);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.subs.delete(channel);
    };
  }

  async setPresence(accountId: string, roomId: string, ttlMs: number): Promise<void> {
    this.presence.set(accountId, { roomId, expiresAt: this.clock() + ttlMs });
  }

  async clearPresence(accountId: string): Promise<void> {
    this.presence.delete(accountId);
  }

  async getPresence(accountId: string): Promise<string | null> {
    this.sweep();
    return this.presence.get(accountId)?.roomId ?? null;
  }

  async listRoom(roomId: string): Promise<string[]> {
    this.sweep();
    return [...this.presence].filter(([, p]) => p.roomId === roomId).map(([id]) => id).sort();
  }

  async roomCounts(): Promise<Record<string, number>> {
    this.sweep();
    const out: Record<string, number> = {};
    for (const p of this.presence.values()) out[p.roomId] = (out[p.roomId] ?? 0) + 1;
    return out;
  }

  async close(): Promise<void> {
    this.subs.clear();
    this.presence.clear();
  }

  private sweep() {
    const now = this.clock();
    for (const [id, p] of this.presence) if (p.expiresAt <= now) this.presence.delete(id);
  }
}

// ---------------------------------------------------------------------------------------------

export interface RedisBusOptions {
  url: string;
  /** Prefixo de todas as chaves e canais (padrao "wv:"); separa ambientes que dividem um Redis. */
  prefix?: string;
  redis?: RedisOptions;
}

/**
 * Presenca em Redis:
 *  - `<p>presence:acc:<accountId>` = roomId, com TTL (PX)
 *  - `<p>presence:room:<roomId>`   = ZSET accountId -> instante de expiracao (ms); entradas vencidas
 *    sao ignoradas na leitura e removidas por ZREMRANGEBYSCORE.
 * Pub/sub usa uma conexao dedicada em modo assinante.
 */
export class RedisBus implements PresenceBus {
  private readonly pub: Redis;
  private sub: Redis | null = null;
  private readonly prefix: string;
  private handlers = new Map<string, Set<BusHandler>>();

  constructor(opts: RedisBusOptions) {
    this.prefix = opts.prefix ?? DEFAULT_PREFIX;
    this.pub = new Redis(opts.url, { maxRetriesPerRequest: 2, ...opts.redis });
    this.pub.on('error', () => undefined); // erros chegam como rejeicao das chamadas; evita "Unhandled error event"
    this.subOptions = { url: opts.url, redis: opts.redis };
  }
  private subOptions: { url: string; redis?: RedisOptions };

  static fromEnv(env: NodeJS.ProcessEnv = process.env): RedisBus | null {
    return env.REDIS_URL ? new RedisBus({ url: env.REDIS_URL, prefix: env.REDIS_PREFIX || undefined }) : null;
  }

  private ch(channel: string) {
    return `${this.prefix}ch:${channel}`;
  }
  private accKey(accountId: string) {
    return `${this.prefix}presence:acc:${accountId}`;
  }
  private roomKey(roomId: string) {
    return `${this.prefix}presence:room:${roomId}`;
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.pub.publish(this.ch(channel), message);
  }

  async subscribe(channel: string, handler: BusHandler): Promise<Unsubscribe> {
    if (!this.sub) {
      const sub = new Redis(this.subOptions.url, { maxRetriesPerRequest: 2, ...this.subOptions.redis });
      sub.on('error', () => undefined);
      sub.on('message', (full: string, message: string) => {
        const channel = full.slice(`${this.prefix}ch:`.length);
        for (const h of [...(this.handlers.get(channel) ?? [])]) {
          try {
            h(message, channel);
          } catch {
            /* isolar assinantes */
          }
        }
      });
      this.sub = sub;
    }
    let set = this.handlers.get(channel);
    if (!set) {
      this.handlers.set(channel, (set = new Set()));
      await this.sub.subscribe(this.ch(channel));
    }
    set.add(handler);
    return async () => {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(channel);
        await this.sub?.unsubscribe(this.ch(channel));
      }
    };
  }

  async setPresence(accountId: string, roomId: string, ttlMs: number): Promise<void> {
    const now = Date.now();
    const previous = await this.pub.getset(this.accKey(accountId), roomId);
    const tx = this.pub.multi();
    tx.pexpire(this.accKey(accountId), ttlMs);
    if (previous && previous !== roomId) tx.zrem(this.roomKey(previous), accountId);
    tx.zadd(this.roomKey(roomId), now + ttlMs, accountId);
    tx.pexpire(this.roomKey(roomId), ttlMs * 4);
    await tx.exec();
  }

  async clearPresence(accountId: string): Promise<void> {
    const room = await this.pub.get(this.accKey(accountId));
    await this.pub.del(this.accKey(accountId));
    if (room) await this.pub.zrem(this.roomKey(room), accountId);
  }

  async getPresence(accountId: string): Promise<string | null> {
    return this.pub.get(this.accKey(accountId));
  }

  async listRoom(roomId: string): Promise<string[]> {
    const key = this.roomKey(roomId);
    const now = Date.now();
    await this.pub.zremrangebyscore(key, '-inf', now);
    return (await this.pub.zrangebyscore(key, `(${now}`, '+inf')).sort();
  }

  async roomCounts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const match = `${this.prefix}presence:room:*`;
    let cursor = '0';
    do {
      const [next, keys] = await this.pub.scan(cursor, 'MATCH', match, 'COUNT', 200);
      cursor = next;
      for (const key of keys) {
        const roomId = key.slice(`${this.prefix}presence:room:`.length);
        const n = (await this.listRoom(roomId)).length;
        if (n > 0) out[roomId] = n;
      }
    } while (cursor !== '0');
    return out;
  }

  async close(): Promise<void> {
    this.handlers.clear();
    await Promise.allSettled([this.pub.quit(), this.sub?.quit()]);
    this.pub.disconnect();
    this.sub?.disconnect();
  }
}

/** REDIS_URL definido -> RedisBus; senao MemoryBus. */
export function createBus(env: NodeJS.ProcessEnv = process.env): PresenceBus {
  return RedisBus.fromEnv(env) ?? new MemoryBus();
}
