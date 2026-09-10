"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusRouter = void 0;
const express_1 = require("express");
const client_1 = require("../whatsapp/client");
exports.statusRouter = (0, express_1.Router)();
exports.statusRouter.get('/', (_req, res) => {
    const { status, uptime_seconds } = (0, client_1.getStatus)();
    res.json({
        whatsapp: status,
        uptime_seconds,
        queue_length: (0, client_1.getQueueLength)(),
    });
});
//# sourceMappingURL=status.js.map