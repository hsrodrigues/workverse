import type { Pool } from 'pg';
import { AUDIT_CAP, MemoryAccountStore, nameKey, type Account, type NewAccount, type SessionRecord } from '../store';
import { OrgService } from '../org';
import type { AuditRecord } from '@workverse/shared';
import { opToSql, orgDataFromRows, type OrgRows } from './orgMapping';
import {
  accountFromRow,
  accountParams,
  sessionFromRow,
  sessionParams,
  INSERT_SESSION_SQL,
  UPSERT_ACCOUNT_SQL,
  INSERT_AUDIT_SQL,
  auditFromRow,
  auditParams,
  type AccountRow,
  type AuditRow,
  type SessionRow,
} from './mapping';

export interface PgStoreOptions {
  /** Atraso inicial do retry (dobra a cada falha ate maxRetryDelayMs). */
  retryBaseMs?: number;
  maxRetryDelayMs?: number;
  /** Relogio usado so para descartar sessoes expiradas no carregamento. */
  clock?: () => number;
  /** E-mail que vira owner da org padrao na migracao das contas antigas (padrao: BOOTSTRAP_OWNER_EMAIL). */
  bootstrapOwnerEmail?: string;
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: unknown) => void;
}

export interface PgStoreStats {
  /** Escritas ainda nao confirmadas pelo banco (inclui a que esta em andamento). */
  queued: number;
  /** Maior tamanho de fila visto desde o boot. */
  maxQueued: number;
  written: number;
  retries: number;
  /** Escritas descartadas por erro permanente (violacao de unicidade/FK, dado invalido). */
  dropped: number;
  lastError?: string;
}

interface Op {
  sql: string;
  params: unknown[];
  /** Operacoes com a mesma chave ainda nao iniciadas sao fundidas (vale a ultima). */
  key?: string;
  /** Chamada quando o banco rejeita a operacao de forma permanente. */
  onPermanent?: (err: { code?: string; message: string }) => void;
}

/** Classes SQLSTATE em que repetir nao adianta: dado invalido (22), integridade (23), sintaxe/objeto (42). */
function isPermanent(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' && /^(22|23|42)/.test(code);
}

/**
 * AccountStore com a interface sincrona de sempre: leituras e a checagem de unicidade vem de um cache
 * carregado no boot; as escritas entram numa fila FIFO (write-behind) gravada no Postgres em segundo plano,
 * com retry exponencial. O banco continua sendo a barreira final de unicidade (indices unicos).
 *
 * Premissa: UMA instancia do servidor escreve as contas (a simulacao ja e assim). Com varias instancias
 * o cache de cada uma ficaria desatualizado; se uma escrita colidir com outra instancia, a conta e
 * removida do cache local e o evento fica registrado.
 *
 * Durabilidade: uma queda do processo (kill -9) perde apenas o que ainda estava na fila (normalmente
 * milissegundos). No shutdown, chame `await store.flush()`.
 */
export class PgAccountStore extends MemoryAccountStore {
  private queue: Op[] = [];
  private pendingByKey = new Map<string, Op>();
  private worker: Promise<void> | null = null;
  private waiters: Array<() => void> = [];
  private wake: (() => void) | null = null;
  private closed = false;
  private readonly retryBaseMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly log: NonNullable<PgStoreOptions['log']>;
  private counters = { maxQueued: 0, written: 0, retries: 0, dropped: 0, lastError: undefined as string | undefined };

  private constructor(
    private readonly pool: Pool,
    opts: PgStoreOptions,
  ) {
    super();
    this.retryBaseMs = opts.retryBaseMs ?? 250;
    this.maxRetryDelayMs = opts.maxRetryDelayMs ?? 30_000;
    this.log = opts.log ?? ((level, msg, extra) => console[level === 'info' ? 'log' : level](`[pg-store] ${msg}`, extra ?? ''));
  }

  /** Carrega contas e sessoes validas para o cache. Requer o schema ja migrado. */
  static async open(pool: Pool, opts: PgStoreOptions = {}): Promise<PgAccountStore> {
    const store = new PgAccountStore(pool, opts);
    const now = new Date((opts.clock ?? Date.now)());
    const accounts = await pool.query<AccountRow>('SELECT * FROM accounts');
    for (const row of accounts.rows) store.index(accountFromRow(row));
    const sessions = await pool.query<SessionRow>('SELECT * FROM sessions WHERE expires_at > $1', [now]);
    for (const row of sessions.rows) {
      const s = sessionFromRow(row);
      if (store.accounts.has(s.accountId)) store.sessions.set(s.tokenHash, s);
    }
    // Auditoria de staff (migracao 0004): so os mais recentes ficam em memoria; a tabela guarda tudo.
    const audit = await pool.query<AuditRow>('SELECT * FROM (SELECT * FROM staff_audit ORDER BY at DESC, id DESC LIMIT $1) t ORDER BY at ASC, id ASC', [AUDIT_CAP]);
    store.audit = audit.rows.map(auditFromRow);
    // Organizacoes (migracao 0002). Carregar nao gera escrita; depois disso toda mudanca entra na fila.
    const q = <T extends object>(table: string) => pool.query<T>(`SELECT * FROM ${table}`).then((r) => r.rows);
    store.orgs.load(
      orgDataFromRows({
        orgs: await q<OrgRows['orgs'][number]>('orgs'),
        teams: await q<OrgRows['teams'][number]>('teams'),
        members: await q<OrgRows['members'][number]>('org_members'),
        invites: await q<OrgRows['invites'][number]>('invites'),
      }),
    );
    store.orgs.onOp = (op) => store.enqueue(opToSql(op));
    // Idempotente: contas que ja passaram pela migracao (extra.orgsInit) sao puladas.
    new OrgService(store.orgs, {
      bootstrapOwnerEmail: opts.bootstrapOwnerEmail ?? process.env.BOOTSTRAP_OWNER_EMAIL,
      saveAccount: (a) => store.save(a),
    }).backfill(store.accounts.values());
    return store;
  }

  /** Numero de escritas aguardando gravacao (metrica / alarme de atraso do banco). */
  get queueSize(): number {
    return this.queue.length;
  }

  get stats(): PgStoreStats {
    return { queued: this.queue.length, ...this.counters };
  }

  // --- AccountStore (escritas) ---

  override create(input: NewAccount): Account {
    const account = super.create(input); // valida duplicidade no cache e chama this.save()
    this.enqueueAccount(account);
    return account;
  }

  override save(account: Account): void {
    super.save(account);
    this.enqueueAccount(account);
  }

  override createSession(session: SessionRecord): void {
    super.createSession(session);
    this.enqueue({ sql: INSERT_SESSION_SQL, params: sessionParams(session), onPermanent: () => this.sessions.delete(session.tokenHash) });
  }

  override appendAudit(record: AuditRecord): void {
    super.appendAudit(record);
    this.enqueue({ sql: INSERT_AUDIT_SQL, params: auditParams(record) });
  }

  override deleteSession(tokenHash: string): void {
    super.deleteSession(tokenHash);
    this.enqueue({ sql: 'DELETE FROM sessions WHERE token_hash = $1', params: [tokenHash] });
  }

  override deleteSessionsOf(accountId: string): void {
    super.deleteSessionsOf(accountId);
    this.enqueue({ sql: 'DELETE FROM sessions WHERE account_id = $1', params: [accountId] });
  }

  override deleteExpiredSessions(now: number): void {
    super.deleteExpiredSessions(now);
    this.enqueue({ sql: 'DELETE FROM sessions WHERE expires_at <= $1', params: [new Date(now)], key: 'expired' });
  }

  // --- fila ---

  private enqueueAccount(account: Account): void {
    this.enqueue({
      sql: UPSERT_ACCOUNT_SQL,
      params: accountParams(account),
      key: `account:${account.id}`,
      onPermanent: (err) => {
        if (err.code === '23505') this.evict(account);
      },
    });
  }

  private enqueue(op: Op): void {
    if (this.closed) {
      this.log('warn', 'escrita ignorada: store ja encerrado');
      return;
    }
    if (op.key) {
      const waiting = this.pendingByKey.get(op.key);
      if (waiting) {
        waiting.params = op.params;
        return;
      }
      this.pendingByKey.set(op.key, op);
    }
    this.queue.push(op);
    this.counters.maxQueued = Math.max(this.counters.maxQueued, this.queue.length);
    // Adia o inicio para o fim do tick: escritas do mesmo handler (ex.: create() + save()) se fundem
    // antes de a primeira entrar "em andamento", em vez de virar duas gravacoes.
    if (!this.worker) this.worker = Promise.resolve().then(() => this.run());
  }

  private async run(): Promise<void> {
    let attempt = 0;
    try {
      while (this.queue.length > 0) {
        const op = this.queue[0]!;
        if (op.key && this.pendingByKey.get(op.key) === op) this.pendingByKey.delete(op.key); // em andamento: novas escritas viram outra op
        try {
          await this.pool.query(op.sql, op.params);
          this.queue.shift();
          this.counters.written++;
          attempt = 0;
        } catch (err) {
          const e = err as { code?: string; message: string };
          this.counters.lastError = e.message;
          if (isPermanent(err)) {
            this.queue.shift();
            this.counters.dropped++;
            this.log('error', `escrita descartada (${e.code}): ${e.message}`);
            op.onPermanent?.(e);
            attempt = 0;
            continue;
          }
          this.counters.retries++;
          const delay = Math.min(this.maxRetryDelayMs, this.retryBaseMs * 2 ** attempt) * (0.75 + Math.random() * 0.5);
          attempt++;
          this.log('warn', `falha ao gravar (tentativa ${attempt}), nova tentativa em ${Math.round(delay)}ms: ${e.message}`);
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, delay);
            this.wake = () => {
              clearTimeout(t);
              resolve();
            };
          });
          this.wake = null;
        }
      }
    } finally {
      this.worker = null;
      const waiters = this.waiters.splice(0);
      for (const w of waiters) w();
    }
  }

  /** Remove do cache uma conta que o banco recusou por unicidade (outra instancia chegou antes). */
  private evict(account: Account): void {
    this.log('error', `conta ${account.id} colidiu com outra no banco e foi removida do cache`);
    if (this.accounts.get(account.id) === account) this.accounts.delete(account.id);
    if (this.byEmail.get(account.email) === account) this.byEmail.delete(account.email);
    if (this.byName.get(nameKey(account.displayName)) === account) this.byName.delete(nameKey(account.displayName));
    for (const [hash, s] of this.sessions) if (s.accountId === account.id) this.sessions.delete(hash);
  }

  /**
   * Espera a fila esvaziar. Rejeita se passar de `timeoutMs` (o banco segue indisponivel);
   * nesse caso as escritas pendentes continuam na fila e `queueSize` diz quantas se perderiam.
   */
  async flush(timeoutMs = 10_000): Promise<void> {
    if (this.queue.length === 0 && !this.worker) return;
    this.wake?.(); // nao espera o backoff inteiro: tenta de novo agora
    let timer: NodeJS.Timeout | undefined;
    const done = new Promise<void>((resolve) => this.waiters.push(resolve));
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`flush excedeu ${timeoutMs}ms com ${this.queue.length} escrita(s) pendente(s)`)), timeoutMs);
    });
    try {
      await Promise.race([done, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** flush() e depois recusa novas escritas. Nao fecha o pool (quem o criou o fecha). */
  async close(timeoutMs?: number): Promise<void> {
    try {
      await this.flush(timeoutMs);
    } finally {
      this.closed = true;
    }
  }
}
