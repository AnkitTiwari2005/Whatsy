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
const crypto_1 = __importDefault(require("crypto"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = require("./config");
const logger_1 = require("./logger");
const db_1 = require("./db");
const http_1 = require("./util/http");
const client_1 = require("./whatsapp/client");
const adminAuth_1 = require("./api/middleware/adminAuth");
const auth_1 = require("./api/middleware/auth");
const messages_1 = require("./api/messages");
const otp_1 = require("./api/otp");
const status_1 = require("./api/status");
const projects_1 = require("./api/admin/projects");
const logs_1 = require("./api/admin/logs");
const pair_1 = __importDefault(require("./api/admin/pair"));
const limitJson = (message) => ({ error: message, code: 'rate_limited' });
function createApp() {
    const app = (0, express_1.default)();
    app.disable('x-powered-by');
    app.set('trust proxy', config_1.config.trustProxy);
    app.use((0, helmet_1.default)({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], fontSrc: ["'self'"], objectSrc: ["'none'"],
                baseUri: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"],
                'upgrade-insecure-requests': null,
            },
        },
    }));
    // Request id for support/debugging; echoed on every response and on 500 bodies.
    app.use((req, res, next) => { const id = crypto_1.default.randomUUID(); req.id = id; res.set('X-Request-Id', id); next(); });
    // CORS is opt-in (CORS_ORIGINS=https://a.com,https://b.com). Server-to-server callers and the same-origin admin UI don't need it.
    if (config_1.config.corsOrigins.length)
        app.use('/api/v1', (0, cors_1.default)({ origin: config_1.config.corsOrigins }));
    app.use(express_1.default.json({ limit: '64kb' }));
    // Wrong/missing Content-Type → a clear 415/400 instead of an undefined req.body crash.
    app.use((req, res, next) => {
        if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
            const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'];
            if (hasBody && !req.is('application/json')) {
                res.status(415).json({ error: 'Content-Type must be application/json', code: 'unsupported_media_type' });
                return;
            }
        }
        if (req.body === undefined || req.body === null || typeof req.body !== 'object' || Array.isArray(req.body))
            req.body = {};
        next();
    });
    const ipLimiter = (0, express_rate_limit_1.default)({ windowMs: 60_000, limit: config_1.config.ipRatePerMin, standardHeaders: true, legacyHeaders: false, message: limitJson('Too many requests from this address') });
    // Per-project limits are applied AFTER authentication, so one noisy/hostile client cannot starve other projects.
    const perProject = (limit, label) => (0, express_rate_limit_1.default)({
        windowMs: 60_000, limit, standardHeaders: true, legacyHeaders: false,
        keyGenerator: (req) => `p${req.project.id}`,
        message: limitJson(`Rate limit for ${label} exceeded for this project`),
    });
    app.use('/api/v1/status', ipLimiter, status_1.statusRouter);
    app.use('/api/v1/messages', ipLimiter, auth_1.apiKeyAuth, perProject(config_1.config.messagesRatePerMin, 'messages'), messages_1.messagesRouter);
    app.use('/api/v1/otp', ipLimiter, auth_1.apiKeyAuth, perProject(config_1.config.otpRatePerMin, 'OTP'), otp_1.otpRouter);
    app.use('/admin/projects', adminAuth_1.adminKeyAuth, projects_1.projectsRouter);
    app.use('/admin/messages', adminAuth_1.adminKeyAuth, logs_1.logsRouter);
    app.use('/admin/pair', adminAuth_1.adminKeyAuth, pair_1.default);
    app.use('/admin/ui', express_1.default.static(path_1.default.join(__dirname, 'admin-ui'), {
        maxAge: '1h',
        setHeaders: (res, file) => { if (file.endsWith('.html'))
            res.setHeader('Cache-Control', 'no-cache'); },
    }));
    app.get('/admin', (_req, res) => res.redirect('/admin/ui/'));
    app.get('/health', (_req, res) => {
        const db = (0, db_1.dbHealthy)();
        res.status(db ? 200 : 503).json({ ok: db, db, whatsapp: (0, client_1.getStatus)().status });
    });
    app.use((_req, res) => res.status(404).json({ error: 'Not found', code: 'not_found' }));
    // Central error handler: client mistakes are 4xx, only genuine faults are 500 (with a request id to quote).
    app.use((err, req, res, _next) => {
        if (err instanceof http_1.HttpError) {
            res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
            return;
        }
        if (err?.type === 'entity.parse.failed') {
            res.status(400).json({ error: 'Request body is not valid JSON', code: 'invalid_json' });
            return;
        }
        if (err?.type === 'entity.too.large') {
            res.status(413).json({ error: 'Request body too large (max 64 KB)', code: 'payload_too_large' });
            return;
        }
        if (err?.status && err.status >= 400 && err.status < 500) {
            res.status(err.status).json({ error: err.message || 'Bad request', code: 'bad_request' });
            return;
        }
        logger_1.logger.error({ err, path: req.path, method: req.method, requestId: req.id }, 'Unhandled Express error');
        res.status(500).json({ error: 'Internal server error', code: 'internal_error', request_id: req.id });
    });
    return app;
}
//# sourceMappingURL=app.js.map