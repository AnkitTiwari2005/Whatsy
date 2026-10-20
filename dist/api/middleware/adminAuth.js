"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminKeyAuth = adminKeyAuth;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../../config");
const logger_1 = require("../../logger");
const failureLimiter_1 = require("./failureLimiter");
const failures = new failureLimiter_1.FailureLimiter(config_1.config.adminFailMax, config_1.config.adminFailWindowSec * 1000);
const expected = crypto_1.default.createHash('sha256').update(config_1.config.adminKey).digest();
/** Admin auth: constant-time compare + lockout of an IP after repeated wrong keys (even if a later guess is right). */
function adminKeyAuth(req, res, next) {
    const ip = req.ip || 'unknown';
    const wait = failures.retryAfter(ip);
    if (wait > 0) {
        res.set('Retry-After', String(wait));
        res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`, code: 'too_many_attempts', retry_after_seconds: wait });
        return;
    }
    const provided = req.header('x-admin-key');
    const ok = !!provided && crypto_1.default.timingSafeEqual(crypto_1.default.createHash('sha256').update(provided).digest(), expected);
    if (!ok) {
        failures.fail(ip);
        logger_1.logger.warn({ ip }, 'Failed admin authentication');
        res.status(401).json({ error: 'Invalid or missing X-Admin-Key header', code: 'unauthorized' });
        return;
    }
    next();
}
//# sourceMappingURL=adminAuth.js.map