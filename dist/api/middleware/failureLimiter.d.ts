/** In-memory sliding failure counter keyed by client IP (single-process app, so no shared store is needed). */
export declare class FailureLimiter {
    private max;
    private windowMs;
    private hits;
    constructor(max: number, windowMs: number);
    /** Seconds the caller must wait, or 0 if allowed. */
    retryAfter(key: string): number;
    fail(key: string): void;
}
//# sourceMappingURL=failureLimiter.d.ts.map