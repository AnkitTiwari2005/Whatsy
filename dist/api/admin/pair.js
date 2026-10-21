"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pairRouter = void 0;
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("../../whatsapp/client");
const logger_1 = require("../../logger");
const config_1 = require("../../config");
const http_1 = require("../../util/http");
const phone_1 = require("../../util/phone");
exports.pairRouter = (0, express_1.Router)();
// GET /admin/pair/status — everything the console needs to render the pairing wizard (polled by the UI)
exports.pairRouter.get('/status', (_req, res) => {
    res.json({ ...(0, client_1.getStatus)(), queue_length: (0, client_1.getQueueLength)() });
});
// GET /admin/pair/connection-log — view recent connection events for soak test monitoring
exports.pairRouter.get('/connection-log', (_req, res) => {
    const logFile = path_1.default.join(config_1.config.dataDir, 'connection.log');
    try {
        if (!fs_1.default.existsSync(logFile)) {
            res.json({ lines: [] });
            return;
        }
        const content = fs_1.default.readFileSync(logFile, 'utf8');
        const lines = content.trim().split('\n').filter(Boolean).slice(-100);
        res.json({ lines });
    }
    catch (err) {
        res.json({ lines: [], error: err.message });
    }
});
exports.pairRouter.post('/', async (req, res) => {
    const raw = req.body?.phone_number ?? req.body?.phone ?? req.body?.recipient;
    const p = (0, phone_1.normalizePhone)(raw);
    if (!p.ok)
        throw new http_1.HttpError(400, 'invalid_phone', `phone_number ${p.error}`);
    const code = await (0, client_1.requestPairing)(p.digits);
    logger_1.logger.info('Pairing code issued');
    res.json({
        pairing_code: code,
        instructions: [
            'Open WhatsApp on your phone',
            'Go to Settings → Linked Devices → Link a Device',
            'Tap "Link with phone number instead"',
            'Enter the pairing code shown here',
            'Wait about 10 seconds — this page updates automatically when linked',
        ],
    });
});
// POST /admin/pair/unlink — log out and remove the stored session so a different number can be paired
exports.pairRouter.post('/unlink', async (_req, res) => {
    await (0, client_1.unlinkSession)();
    res.json({ ok: true, message: 'Session removed. You can pair a number now.' });
});
exports.default = exports.pairRouter;
//# sourceMappingURL=pair.js.map