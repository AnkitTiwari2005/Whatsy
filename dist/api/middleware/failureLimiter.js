"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FailureLimiter = void 0;
/** In-memory sliding failure counter keyed by client IP (single-process app, so no shared store is needed). */
class FailureLimiter {
    max;
    windowMs;
    hits = new Map();
    constructor(max, windowMs) {
        this.max = max;
        this.windowMs = windowMs;
        setInterval(() => { const now = Date.now(); for (const [k, v] of this.hits)
            if (v.reset <= now)
                this.hits.delete(k); }, 60_000).unref();
    }
    /** Seconds the caller must wait, or 0 if allowed. */
    retryAfter(key) {
        const v = this.hits.get(key);
        if (!v || v.reset <= Date.now() || v.n < this.max)
            return 0;
        return Math.max(1, Math.ceil((v.reset - Date.now()) / 1000));
    }
    fail(key) {
        const now = Date.now();
        const v = this.hits.get(key);
        if (!v || v.reset <= now)
            this.hits.set(key, { n: 1, reset: now + this.windowMs });
        else
            v.n++;
    }
}
exports.FailureLimiter = FailureLimiter;
//# sourceMappingURL=failureLimiter.js.map