/** Token bucket used to throttle abusive clients. `now` is injectable for tests. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now = Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  take(now = Date.now(), cost = 1): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }

  /** True when the bucket has fully refilled, so forgetting it changes nothing. */
  isIdle(now = Date.now()): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000;
    return this.tokens + elapsed * this.refillPerSecond >= this.capacity;
  }

  /** Seconds until at least `cost` tokens are available. */
  retryAfterSeconds(now = Date.now(), cost = 1): number {
    const elapsed = Math.max(0, now - this.last) / 1000;
    const tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    if (tokens >= cost) return 0;
    return Math.ceil((cost - tokens) / this.refillPerSecond);
  }
}

/** A set of token buckets keyed by string (IP, e-mail, ...) with bounded memory. */
export class KeyedLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly maxKeys = 10_000,
  ) {}

  take(key: string, now = Date.now()): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) this.sweep(now);
      bucket = new TokenBucket(this.capacity, this.refillPerSecond, now);
      this.buckets.set(key, bucket);
    }
    return bucket.take(now);
  }

  retryAfterSeconds(key: string, now = Date.now()): number {
    return this.buckets.get(key)?.retryAfterSeconds(now) ?? 0;
  }

  private sweep(now: number) {
    for (const [key, bucket] of this.buckets) if (bucket.isIdle(now)) this.buckets.delete(key);
    // Still full of active keys (an attack): drop the oldest half rather than grow without bound.
    if (this.buckets.size >= this.maxKeys) {
      let drop = Math.ceil(this.buckets.size / 2);
      for (const key of this.buckets.keys()) {
        if (drop-- <= 0) break;
        this.buckets.delete(key);
      }
    }
  }
}
