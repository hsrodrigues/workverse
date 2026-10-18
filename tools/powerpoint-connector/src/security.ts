import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { POWERPOINT_PAIR_CODE_LENGTH } from '@workverse/shared';

export function newPairCode(): string {
  return String(randomInt(0, 10 ** POWERPOINT_PAIR_CODE_LENGTH)).padStart(POWERPOINT_PAIR_CODE_LENGTH, '0');
}

export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time comparison (hashes first, so lengths do not leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Token bucket: `capacity` actions at once, refilled at `perSecond`. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }
  take(cost = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSecond);
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
  retryAfterSeconds(cost = 1): number {
    return Math.max(1, Math.ceil((cost - this.tokens) / this.perSecond));
  }
}

export function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function parseOrigins(list: Array<string | undefined>): string[] {
  const out = new Set<string>();
  for (const item of list) {
    for (const part of (item ?? '').split(',')) {
      const o = normalizeOrigin(part);
      if (o) out.add(o);
    }
  }
  return [...out];
}

/** Only the loopback names, with the port the connector really listens on (defends against DNS rebinding). */
export function hostAllowed(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const h = hostHeader.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`;
}
