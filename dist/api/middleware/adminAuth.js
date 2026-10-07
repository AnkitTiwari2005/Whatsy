"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminKeyAuth = adminKeyAuth;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../../config");
function adminKeyAuth(req, res, next) {
    const provided = req.headers['x-admin-key'];
    if (!provided) {
        res.status(401).json({ error: 'Invalid or missing X-Admin-Key header' });
        return;
    }
    // Pre-hash both strings to SHA-256 to ensure equal-length 32-byte buffers for constant-time comparison
    const providedHash = crypto_1.default.createHash('sha256').update(provided).digest();
    const expectedHash = crypto_1.default.createHash('sha256').update(config_1.config.adminKey).digest();
    if (!crypto_1.default.timingSafeEqual(providedHash, expectedHash)) {
        res.status(401).json({ error: 'Invalid or missing X-Admin-Key header' });
        return;
    }
    next();
}
//# sourceMappingURL=adminAuth.js.map