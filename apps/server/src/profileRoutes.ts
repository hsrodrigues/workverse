import type { FastifyInstance, FastifyReply } from 'fastify';
import { DEFAULT_NAME_LIMITS, nextNameChangeAt, parseProfilePatch, type AccountProfile, type ApiErrorBody, type NameChangeLimits, type ProfileView } from '@workverse/shared';
import { authenticate, type AuthDeps } from './authRoutes';
import { KeyedLimiter } from './limiter';
import { DuplicateAccountError, type Account } from './store';
import { isReservedName } from './world';
import { profileViewOf, renameAudit } from './profileService';

/**
 * "Meu perfil": GET/PATCH /api/profile. So a PROPRIA conta (a sessao decide; nao existe parametro de id). O corpo e
 * validado por chave (parseProfilePatch recusa cargo, setor, e-mail, staff...). Ver docs/profile.md.
 */
const BODY_LIMIT = 2048;
const KEEP_NAME_CHANGES = 20;

export interface ProfileRouteOptions {
  nameLimits?: NameChangeLimits;
}

/** PROFILE_NAME_COOLDOWN_HOURS (padrao 24), PROFILE_NAME_MAX_CHANGES (padrao 5) e PROFILE_NAME_WINDOW_DAYS (padrao 30). */
export function nameLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): NameChangeLimits {
  const num = (v: string | undefined, d: number, min: number, max: number) => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) && n >= min && n <= max ? n : d;
  };
  return {
    cooldownMs: num(env.PROFILE_NAME_COOLDOWN_HOURS, DEFAULT_NAME_LIMITS.cooldownMs / 3600_000, 0, 24 * 365) * 3600_000,
    maxChanges: Math.floor(num(env.PROFILE_NAME_MAX_CHANGES, DEFAULT_NAME_LIMITS.maxChanges, 1, 50)),
    windowMs: num(env.PROFILE_NAME_WINDOW_DAYS, DEFAULT_NAME_LIMITS.windowMs / 86_400_000, 1, 365) * 86_400_000,
  };
}

function fail(reply: FastifyReply, status: number, code: string, message: string, extra?: { retryAfterSeconds?: number; field?: string }) {
  if (extra?.retryAfterSeconds !== undefined) void reply.header('Retry-After', String(extra.retryAfterSeconds));
  const body: ApiErrorBody & { error: { field?: string } } = { error: { code, message, ...(extra?.retryAfterSeconds !== undefined ? { retryAfterSeconds: extra.retryAfterSeconds } : {}), ...(extra?.field ? { field: extra.field } : {}) } };
  return reply.code(status).send(body);
}

export function registerProfileRoutes(app: FastifyInstance, deps: AuthDeps, opts: ProfileRouteOptions = {}) {
  const { store, world, clock } = deps;
  const limits = opts.nameLimits ?? nameLimitsFromEnv();
  // Leitura generosa, escrita moderada: 12 gravacoes em rajada e depois 1 a cada 5 s por conta.
  const writes = new KeyedLimiter(12, 1 / 5);
  const reads = new KeyedLimiter(30, 1);

  const view = (account: Account): ProfileView => {
    const live = world.findPlayerByAccount(account.id);
    const orgId = live?.orgId ?? account.lastOrg;
    const tag = orgId ? world.orgService.profileOf(orgId, account.id) : {};
    return profileViewOf(account, tag, clock(), nextNameChangeAt(account.profile?.nameChanges, clock(), limits), limits.cooldownMs / 3600_000);
  };

  app.get('/api/profile', async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    const auth = authenticate(deps, req.headers.cookie);
    if (!auth) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
    if (!reads.take(auth.account.id, clock())) return fail(reply, 429, 'rate_limited', 'Muitas consultas. Aguarde um instante.', { retryAfterSeconds: 5 });
    return { profile: view(auth.account) };
  });

  app.patch('/api/profile', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    const auth = authenticate(deps, req.headers.cookie);
    if (!auth) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
    const account = auth.account;
    const now = clock();
    if (!writes.take(account.id, now)) return fail(reply, 429, 'rate_limited', 'Você está salvando rápido demais. Aguarde alguns segundos.', { retryAfterSeconds: Math.max(1, Math.ceil(writes.retryAfterSeconds(account.id, now))) });

    const parsed = parseProfilePatch(req.body);
    if (!parsed.ok) return fail(reply, 400, parsed.issue.code, parsed.issue.message, { field: parsed.issue.field });
    const patch = parsed.patch;
    const muted = !!account.mute && account.mute.until > now;
    if (muted && (patch.displayName !== undefined || patch.about !== undefined)) {
      return fail(reply, 403, 'muted', 'Você está silenciado e não pode alterar o nome nem o "sobre mim" agora.');
    }

    // 1) tudo que pode falhar, antes de mudar qualquer coisa
    let rename: string | null = null;
    if (patch.displayName !== undefined && patch.displayName !== account.displayName) {
      const name = patch.displayName;
      if (isReservedName(name)) return fail(reply, 400, 'bad_name', 'Esse nome é reservado. Escolha outro.', { field: 'displayName' });
      const owner = store.getByName(name);
      if (owner && owner.id !== account.id) return fail(reply, 409, 'name_taken', 'Esse nome já está em uso por outra pessoa.', { field: 'displayName' });
      const at = nextNameChangeAt(account.profile?.nameChanges, now, limits);
      if (at > 0) {
        const secs = Math.max(1, Math.ceil((at - now) / 1000));
        const hours = Math.ceil(secs / 3600);
        return fail(reply, 429, 'name_cooldown', `Você já trocou de nome há pouco. A próxima troca fica disponível em ${hours >= 2 ? `${hours} horas` : 'cerca de 1 hora'}.`, { retryAfterSeconds: secs, field: 'displayName' });
      }
      rename = name;
    }

    // 2) aplica
    const prof: AccountProfile = { ...(account.profile ?? {}) };
    if (patch.about !== undefined) {
      if (patch.about === null) delete prof.about;
      else prof.about = patch.about;
    }
    if (patch.pronouns !== undefined) {
      if (patch.pronouns === null) delete prof.pronouns;
      else prof.pronouns = patch.pronouns;
    }
    if (patch.birthday !== undefined) {
      if (patch.birthday === null) {
        delete prof.birthday;
        delete prof.birthdayVisible;
        delete prof.birthdayChat;
        delete prof.lastBdayGreet;
      } else {
        prof.birthday = patch.birthday;
        delete prof.lastBdayGreet;
      }
    }
    // As opcoes de aniversario so existem com uma data informada.
    if (patch.birthdayVisible !== undefined && prof.birthday) prof.birthdayVisible = patch.birthdayVisible;
    if (patch.birthdayChat !== undefined && prof.birthday) prof.birthdayChat = patch.birthdayChat;
    if (patch.prefs) prof.prefs = { ...(prof.prefs ?? {}), ...patch.prefs };
    if (rename) {
      const from = account.displayName;
      try {
        store.rename(account.id, rename);
      } catch (err) {
        if (err instanceof DuplicateAccountError) return fail(reply, 409, 'name_taken', 'Esse nome já está em uso por outra pessoa.', { field: 'displayName' });
        throw err;
      }
      prof.nameChanges = [...(prof.nameChanges ?? []), now].slice(-KEEP_NAME_CHANGES);
      store.appendAudit(renameAudit(account, from, rename, now));
      app.log.info({ event: 'profile.rename', account: account.id }, 'audit');
    }
    if (Object.keys(prof).length > 0) account.profile = prof;
    else delete account.profile;
    store.save(account);
    world.applyProfile(account.id);
    app.log.info({ event: 'profile.update', account: account.id, fields: Object.keys(patch) }, 'audit');
    return { profile: view(account) };
  });
}
