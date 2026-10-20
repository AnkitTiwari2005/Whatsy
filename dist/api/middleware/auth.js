"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashApiKey = exports.KEY_HASH_PREFIX = void 0;
exports.apiKeyAuth = apiKeyAuth;
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../../db");
const logger_1 = require("../../logger");
const failureLimiter_1 = require("./failureLimiter");
exports.KEY_HASH_PREFIX = 'sha256$';
/** API keys are 256-bit random values, so a fast hash is sufficient (bcrypt only protects low-entropy secrets). */
const hashApiKey = (raw) => exports.KEY_HASH_PREFIX + crypto_1.default.createHash('sha256').update(raw).digest('hex');
exports.hashApiKey = hashApiKey;
const badKeyLimiter = new failureLimiter_1.FailureLimiter(30, 5 * 60_000);
const SELECT = `SELECT k.id, k.key_hash, k.project_id, p.name, p.default_recipient
                FROM api_keys k JOIN projects p ON p.id = k.project_id
                WHERE k.active = 1 AND p.active = 1 AND `;
/**
 * Resolve X-Api-Key → project. O(1) lookup by SHA-256. Legacy bcrypt keys are still accepted
 * and transparently upgraded to SHA-256 on first successful use.
 * Valid keys are never blocked by failed-attempt floods from the same IP; only *invalid* keys get 429.
 */
async function apiKeyAuth(req, res, next) {
    const raw = req.header('x-api-key');
    const ip = req.ip || 'unknown';
    const db = (0, db_1.getDb)();
    let row;
    if (raw && raw.length <= 256) {
        row = db.prepare(SELECT + 'k.key_hash = ?').get((0, exports.hashApiKey)(raw));
        if (!row && !badKeyLimiter.retryAfter(ip)) {
            const candidates = db.prepare(SELECT + `k.key_prefix = ? AND k.key_hash NOT LIKE '${exports.KEY_HASH_PREFIX}%'`).all(raw.slice(0, 8));
            for (const c of candidates) {
                if (await bcryptjs_1.default.compare(raw, c.key_hash)) {
                    row = c;
                    try {
                        db.prepare('UPDATE api_keys SET key_hash = ? WHERE id = ?').run((0, exports.hashApiKey)(raw), c.id);
                    }
                    catch (err) {
                        logger_1.logger.warn({ err }, 'Could not upgrade legacy key hash');
                    }
                    break;
                }
            }
        }
    }
    if (!row) {
        if (!raw) {
            res.status(401).json({ error: 'Missing X-Api-Key header', code: 'missing_api_key' });
            return;
        }
        const wait = badKeyLimiter.retryAfter(ip);
        badKeyLimiter.fail(ip);
        if (wait > 0) {
            res.set('Retry-After', String(wait));
            res.status(429).json({ error: 'Too many invalid API keys from this address', code: 'too_many_attempts', retry_after_seconds: wait });
            return;
        }
        logger_1.logger.warn({ ip }, 'Invalid API key attempt');
        res.status(401).json({ error: 'Invalid or inactive API key', code: 'invalid_api_key' });
        return;
    }
    // Write at most once a minute per key instead of on every request.
    db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now','-60 seconds'))`).run(row.id);
    req.project = { id: row.project_id, name: row.name, default_recipient: row.default_recipient, keyId: row.id };
    next();
}
//# sourceMappingURL=auth.js.map