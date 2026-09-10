"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const path_1 = __importDefault(require("path"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const adminAuth_1 = require("./api/middleware/adminAuth");
const messages_1 = require("./api/messages");
const status_1 = require("./api/status");
const projects_1 = require("./api/admin/projects");
const logs_1 = require("./api/admin/logs");
const pair_1 = __importDefault(require("./api/admin/pair"));
function createApp() {
    const app = (0, express_1.default)();
    app.use((0, helmet_1.default)({ contentSecurityPolicy: false }));
    app.use((0, cors_1.default)({ origin: false }));
    app.use(express_1.default.json({ limit: '64kb' }));
    const apiLimiter = (0, express_rate_limit_1.default)({
        windowMs: 60_000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests, slow down' },
    });
    // Public status — no auth, useful for uptime monitoring
    app.use('/api/v1/status', status_1.statusRouter);
    // Message sending — API key auth applied inside router
    app.use('/api/v1/messages', apiLimiter, messages_1.messagesRouter);
    // Admin routes — ADMIN_KEY required
    app.use('/admin/projects', adminAuth_1.adminKeyAuth, projects_1.projectsRouter);
    app.use('/admin/messages', adminAuth_1.adminKeyAuth, logs_1.logsRouter);
    app.use('/admin/pair', adminAuth_1.adminKeyAuth, pair_1.default);
    // Admin UI — static HTML
    app.use('/admin/ui', express_1.default.static(path_1.default.join(__dirname, 'admin-ui')));
    app.get('/admin', (_req, res) => res.redirect('/admin/ui'));
    // Health check
    app.get('/health', (_req, res) => res.json({ ok: true }));
    // 404
    app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
    // Error handler
    app.use((err, _req, res, _next) => {
        res.status(500).json({ error: 'Internal server error' });
    });
    return app;
}
//# sourceMappingURL=app.js.map