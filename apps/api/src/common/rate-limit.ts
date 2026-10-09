/**
 * A sliding-window counter per key, kept in memory. It protects the database from a runaway client
 * (a stuck loop in the browser, a script with a stolen session) without a separate service. One
 * process keeps its own counts, which is enough while there is a single API process; see
 * docs/operations/monitoring.md for what to change when there are several.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private clock: () => number = () => Date.now();

  constructor(
    private readonly windowMs: number,
    /** most keys remembered at once, so unknown keys cannot grow memory without bound */
    private readonly maxKeys = 50_000,
  ) {}

  setClock(clock: () => number) {
    this.clock = clock;
  }

  reset() {
    this.hits.clear();
  }

  /** Records one request and says whether it is within `limit`, and how long to wait if not. */
  hit(key: string, limit: number): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const now = this.clock();
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= limit) {
      this.hits.set(key, list);
      const oldest = list[0] ?? now;
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
      };
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > this.maxKeys) this.prune(cutoff);
    return { ok: true };
  }

  /** How many requests the key has made in the window, without counting a new one. */
  count(key: string): number {
    const cutoff = this.clock() - this.windowMs;
    return (this.hits.get(key) ?? []).filter((t) => t > cutoff).length;
  }

  private prune(cutoff: number) {
    for (const [k, list] of this.hits) {
      if (list.every((t) => t <= cutoff)) this.hits.delete(k);
    }
    // still too many: drop the oldest keys
    if (this.hits.size > this.maxKeys) {
      for (const k of [...this.hits.keys()].slice(0, this.hits.size - this.maxKeys))
        this.hits.delete(k);
    }
  }
}

/** Requests per shop (after sign-in) and failed sign-ins per address. */
export const limiters = {
  shop: new SlidingWindowLimiter(60_000),
  failedAuth: new SlidingWindowLimiter(60_000),
};

/** Failed sign-ins one address may make a minute before it is told to wait. */
export const FAILED_AUTH_PER_MINUTE = 60;

export function shopLimitPerMinute(): number {
  const raw = process.env.RATE_LIMIT_PER_MINUTE;
  const n = raw === undefined || raw === '' ? 600 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 600;
}
