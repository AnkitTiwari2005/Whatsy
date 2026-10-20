/** In-memory sliding failure counter keyed by client IP (single-process app, so no shared store is needed). */
export class FailureLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(private max: number, private windowMs: number) {
    setInterval(() => { const now = Date.now(); for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k); }, 60_000).unref();
  }
  /** Seconds the caller must wait, or 0 if allowed. */
  retryAfter(key: string): number {
    const v = this.hits.get(key);
    if (!v || v.reset <= Date.now() || v.n < this.max) return 0;
    return Math.max(1, Math.ceil((v.reset - Date.now()) / 1000));
  }
  fail(key: string): void {
    const now = Date.now(); const v = this.hits.get(key);
    if (!v || v.reset <= now) this.hits.set(key, { n: 1, reset: now + this.windowMs }); else v.n++;
  }
}
