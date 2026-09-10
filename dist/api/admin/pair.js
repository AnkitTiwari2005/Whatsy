"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pairRouter = void 0;
const express_1 = require("express");
const client_1 = require("../../whatsapp/client");
const logger_1 = require("../../logger");
exports.pairRouter = (0, express_1.Router)();
exports.pairRouter.post('/', async (req, res) => {
    const { phone_number } = req.body;
    if (!phone_number) {
        res.status(400).json({
            error: 'phone_number is required (digits only, e.g. "919876543210")',
        });
        return;
    }
    const { status } = (0, client_1.getStatus)();
    if (status === 'connected') {
        res.status(409).json({
            error: 'WhatsApp is already connected. Pairing is only needed for fresh or logged-out sessions.',
        });
        return;
    }
    try {
        const code = await (0, client_1.requestPairing)(phone_number);
        logger_1.logger.info({ phone: phone_number }, 'Pairing code issued');
        res.json({
            pairing_code: code,
            instructions: [
                '1. Open WhatsApp on your phone',
                '2. Go to Settings -> Linked Devices -> Link a Device',
                '3. Tap "Link with phone number instead"',
                '4. Enter the pairing code above',
                '5. Wait ~10 seconds — the server will log "WhatsApp connected" when done',
            ],
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger_1.logger.error({ error: message }, 'Pairing failed');
        res.status(500).json({ error: message });
    }
});
exports.default = exports.pairRouter;
//# sourceMappingURL=pair.js.map