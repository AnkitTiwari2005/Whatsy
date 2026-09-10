"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminKeyAuth = adminKeyAuth;
const config_1 = require("../../config");
function adminKeyAuth(req, res, next) {
    const provided = req.headers['x-admin-key'];
    if (!provided || provided !== config_1.config.adminKey) {
        res.status(401).json({ error: 'Invalid or missing X-Admin-Key header' });
        return;
    }
    next();
}
//# sourceMappingURL=adminAuth.js.map