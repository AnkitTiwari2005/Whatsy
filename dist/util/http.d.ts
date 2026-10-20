/** Error that carries an HTTP status + a stable machine-readable code. */
export declare class HttpError extends Error {
    status: number;
    code: string;
    extra: Record<string, unknown>;
    constructor(status: number, code: string, message: string, extra?: Record<string, unknown>);
}
/** SQLite stores UTC as "YYYY-MM-DD HH:MM:SS" (no zone). Emit unambiguous ISO-8601 so every client parses it identically. */
export declare function isoUtc(ts: string | null | undefined): string | null;
export declare function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T>;
//# sourceMappingURL=http.d.ts.map