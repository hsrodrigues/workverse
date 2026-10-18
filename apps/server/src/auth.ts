import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@workverse/shared';
import { KeyedLimiter } from './limiter';

export const SESSION_COOKIE = 'wv_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_EMAIL_LENGTH = 254;
/** Most simultaneous logins (browsers/devices) per account; the oldest are revoked beyond it. */
export const MAX_SESSIONS_PER_ACCOUNT = 10;

// ---- passwords ------------------------------------------------------------

/**
 * OWASP: scrypt N=2^17 (r=8, p=1) preferred; N=2^16 (64 MiB, ~100-200 ms) is the compromise used here so that a burst of
 * parallel logins cannot exhaust a small server. Hashes carry their own parameters, so older ones (N=2^14) keep working
 * and are upgraded on the next successful login (see needsRehash). Tests use the cheap value to stay fast.
 */
export const SCRYPT_PARAMS = { N: process.env.NODE_ENV === 'test' ? 16384 : 65536, r: 8, p: 1 } as const;
const KEY_LEN = 64;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, len: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, len, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Format: `scrypt$N$r$p$salt(base64)$hash(base64)`; the parameters travel with the hash so they can be raised later. */
export async function hashPassword(password: string, params: { N: number; r: number; p: number } = SCRYPT_PARAMS): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, params.N, params.r, params.p, KEY_LEN);
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** True when a stored hash was made with weaker parameters than the current ones (re-hash after a successful login). */
export function needsRehash(stored: string, target: { N: number; r: number; p: number } = SCRYPT_PARAMS): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  return Number(parts[1]) < target.N || Number(parts[2]) < target.r || Number(parts[3]) < target.p;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0) || n > 1 << 20) return false;
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  if (expected.length === 0) return false;
  try {
    const actual = await derive(password, salt, n, r, p, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Burns the same CPU as a real check so an unknown e-mail is not distinguishable by response time. */
export async function fakeVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword('workverse-dummy-password');
  await verifyPassword(password, await dummyHash);
}

// ---- session tokens ---------------------------------------------------------

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key || key in out) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed value */
    }
  }
  return out;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

// ---- validation ---------------------------------------------------------------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.normalize('NFKC').trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

export type PasswordProblem = 'too_short' | 'too_long' | 'invalid' | 'too_common';

/** Passwords of 10+ characters that sit at the top of every leaked-password list (compared in lowercase). */
const COMMON_PASSWORDS = new Set([
  '1234567890', '12345678910', '0123456789', '9876543210', '1234512345', '1111111111', '0000000000', '1q2w3e4r5t', 'qwertyuiop', 'qwertyuiop1',
  'asdfghjkl1', 'asdfghjkl', 'password12', 'password123', 'password1234', 'passw0rd123', 'iloveyou12', 'iloveyou123', 'abc1234567', 'abcdefghij',
  'senha12345', 'senha123456', 'minhasenha', 'minhasenha1', 'minhasenha123', 'mudar12345', 'workverse', 'workverse1', 'workverse123', 'qazwsxedc1',
  'letmein123', 'welcome123', 'administrador', 'admin12345', 'admin123456', 'trustno1234', 'changeme123',
]);

/**
 * Policy: 10 to 128 characters (NIST 800-63B: length over composition rules), nothing from the worst-password lists,
 * not one or two repeated characters, not a plain run (123456..., abcdef...) and not the account's own e-mail / name.
 */
export function checkPassword(raw: unknown, ctx: { email?: string; name?: string } = {}): PasswordProblem | null {
  if (typeof raw !== 'string') return 'invalid';
  const chars = [...raw];
  if (chars.length < MIN_PASSWORD_LENGTH) return 'too_short';
  if (chars.length > MAX_PASSWORD_LENGTH) return 'too_long';
  const lower = raw.normalize('NFKC').toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || new Set(lower).size <= 2) return 'too_common';
  const run = (step: number) => [...lower].every((c, i, a) => i === 0 || c.codePointAt(0)! - a[i - 1]!.codePointAt(0)! === step);
  if (run(1) || run(-1)) return 'too_common';
  if (ctx.email && (lower === ctx.email || lower === ctx.email.split('@')[0])) return 'too_common';
  if (ctx.name && lower === ctx.name.normalize('NFKC').toLowerCase()) return 'too_common';
  return null;
}

// ---- abuse protection -------------------------------------------------------

export interface AuthLimits {
  /** Login attempts: burst and refill per minute, per IP and per e-mail. */
  loginPerIp: { burst: number; perMinute: number };
  loginPerEmail: { burst: number; perMinute: number };
  registerPerIp: { burst: number; perMinute: number };
  registerPerEmail: { burst: number; perMinute: number };
  /** Failed logins (same IP + e-mail) before a temporary lockout starts. */
  lockoutAfter: number;
  lockoutBaseMs: number;
  lockoutMaxMs: number;
  /** Fixed pause before answering a failed login. */
  failDelayMs: number;
}

export const DEFAULT_AUTH_LIMITS: AuthLimits = {
  loginPerIp: { burst: 15, perMinute: 10 },
  loginPerEmail: { burst: 10, perMinute: 5 },
  registerPerIp: { burst: 5, perMinute: 0.2 },
  registerPerEmail: { burst: 3, perMinute: 0.1 },
  lockoutAfter: 5,
  lockoutBaseMs: 30_000,
  lockoutMaxMs: 15 * 60_000,
  failDelayMs: 250,
};

export type Throttle = { ok: true } | { ok: false; retryAfterSeconds: number };

interface FailureState {
  count: number;
  lockedUntil: number;
  lastAt: number;
}

export class AuthGuard {
  private readonly loginIp: KeyedLimiter;
  private readonly loginEmail: KeyedLimiter;
  private readonly registerIp: KeyedLimiter;
  private readonly registerEmail: KeyedLimiter;
  private readonly failures = new Map<string, FailureState>();

  constructor(
    readonly limits: AuthLimits = DEFAULT_AUTH_LIMITS,
    private readonly clock: () => number = Date.now,
  ) {
    const mk = (l: { burst: number; perMinute: number }) => new KeyedLimiter(l.burst, l.perMinute / 60);
    this.loginIp = mk(limits.loginPerIp);
    this.loginEmail = mk(limits.loginPerEmail);
    this.registerIp = mk(limits.registerPerIp);
    this.registerEmail = mk(limits.registerPerEmail);
  }

  checkLogin(ip: string, email: string): Throttle {
    const now = this.clock();
    const fail = this.failures.get(`${ip}|${email}`);
    if (fail && fail.lockedUntil > now) return { ok: false, retryAfterSeconds: Math.ceil((fail.lockedUntil - now) / 1000) };
    if (!this.loginIp.take(ip, now)) {
      return { ok: false, retryAfterSeconds: Math.max(1, this.loginIp.retryAfterSeconds(ip, now)) };
    }
    if (!this.loginEmail.take(email, now)) {
      return { ok: false, retryAfterSeconds: Math.max(1, this.loginEmail.retryAfterSeconds(email, now)) };
    }
    return { ok: true };
  }

  checkRegister(ip: string, email: string): Throttle {
    const now = this.clock();
    if (!this.registerIp.take(ip, now)) {
      return { ok: false, retryAfterSeconds: Math.max(1, this.registerIp.retryAfterSeconds(ip, now)) };
    }
    if (email && !this.registerEmail.take(email, now)) {
      return { ok: false, retryAfterSeconds: Math.max(1, this.registerEmail.retryAfterSeconds(email, now)) };
    }
    return { ok: true };
  }

  /** Records a wrong password. Lockout doubles each time the threshold is crossed again. */
  loginFailed(ip: string, email: string) {
    const now = this.clock();
    if (this.failures.size > 10_000) this.pruneFailures(now);
    const key = `${ip}|${email}`;
    const f = this.failures.get(key) ?? { count: 0, lockedUntil: 0, lastAt: now };
    f.count++;
    f.lastAt = now;
    if (f.count >= this.limits.lockoutAfter) {
      const over = f.count - this.limits.lockoutAfter;
      f.lockedUntil = now + Math.min(this.limits.lockoutMaxMs, this.limits.lockoutBaseMs * 2 ** over);
    }
    this.failures.set(key, f);
  }

  loginSucceeded(ip: string, email: string) {
    this.failures.delete(`${ip}|${email}`);
  }

  private pruneFailures(now: number) {
    for (const [key, f] of this.failures) {
      if (f.lockedUntil <= now && now - f.lastAt > this.limits.lockoutMaxMs) this.failures.delete(key);
    }
  }
}
