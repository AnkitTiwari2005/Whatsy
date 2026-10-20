"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpError = void 0;
exports.isoUtc = isoUtc;
exports.withTimeout = withTimeout;
/** Error that carries an HTTP status + a stable machine-readable code. */
class HttpError extends Error {
    status;
    code;
    extra;
    constructor(status, code, message, extra = {}) {
        super(message);
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
}
exports.HttpError = HttpError;
/** SQLite stores UTC as "YYYY-MM-DD HH:MM:SS" (no zone). Emit unambiguous ISO-8601 so every client parses it identically. */
function isoUtc(ts) {
    if (!ts)
        return null;
    if (ts.includes('T'))
        return ts;
    return ts.replace(' ', 'T') + 'Z';
}
function withTimeout(p, ms, label) {
    let t;
    const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms); });
    return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}
//# sourceMappingURL=http.js.map