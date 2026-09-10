"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeyAuth = apiKeyAuth;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../../db");
const logger_1 = require("../../logger");
async function apiKeyAuth(req, res, next) {
    const rawKey = req.headers['x-api-key'];
    if (!rawKey) {
        res.status(401).json({ error: 'Missing X-Api-Key header' });
        return;
    }
    const db = (0, db_1.getDb)();
    // Look up candidate keys by prefix (first 8 chars) to narrow the bcrypt search
    const prefix = rawKey.slice(0, 8);
    const candidates = db
        .prepare(`SELECT k.id, k.key_hash, k.project_id, k.active,
              p.name, p.default_recipient, p.active as project_active
       FROM api_keys k
       JOIN projects p ON p.id = k.project_id
       WHERE k.key_prefix = ? AND k.active = 1 AND p.active = 1`)
        .all(prefix);
    for (const candidate of candidates) {
        const match = await bcryptjs_1.default.compare(rawKey, candidate.key_hash);
        if (match) {
            db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`).run(candidate.id);
            req.project = {
                id: candidate.project_id,
                name: candidate.name,
                default_recipient: candidate.default_recipient,
                keyId: candidate.id,
            };
            next();
            return;
        }
    }
    logger_1.logger.warn({ prefix }, 'Invalid API key attempt');
    res.status(401).json({ error: 'Invalid or inactive API key' });
}
//# sourceMappingURL=auth.js.map