"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messagesRouter = void 0;
const express_1 = require("express");
const auth_1 = require("./middleware/auth");
const db_1 = require("../db");
const client_1 = require("../whatsapp/client");
const config_1 = require("../config");
const logger_1 = require("../logger");
exports.messagesRouter = (0, express_1.Router)();
exports.messagesRouter.post('/', auth_1.apiKeyAuth, async (req, res) => {
    const { message, recipient } = req.body;
    const project = req.project;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        res.status(400).json({ error: 'message is required and must be a non-empty string' });
        return;
    }
    const resolvedRecipient = recipient ?? project.default_recipient;
    if (!resolvedRecipient) {
        res.status(400).json({
            error: 'recipient is required — project has no default_recipient configured',
        });
        return;
    }
    // Basic E.164 sanity check
    const digits = resolvedRecipient.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
        res.status(400).json({ error: 'recipient must be a valid phone number (E.164 format)' });
        return;
    }
    const { status } = (0, client_1.getStatus)();
    if (status === 'disconnected') {
        logger_1.logger.warn({ projectId: project.id }, 'Queuing message while WhatsApp disconnected');
    }
    const db = (0, db_1.getDb)();
    const loggedBody = config_1.config.redactBodies ? '[redacted]' : message.trim();
    const result = db
        .prepare(`INSERT INTO messages (project_id, recipient, body, status)
       VALUES (?, ?, ?, 'queued')`)
        .run(project.id, resolvedRecipient, loggedBody);
    const messageId = result.lastInsertRowid;
    try {
        (0, client_1.enqueueMessage)({
            messageId,
            recipient: (0, client_1.toJid)(resolvedRecipient),
            body: message.trim(),
        });
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        db.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).run(error, messageId);
        res.status(503).json({ error });
        return;
    }
    logger_1.logger.info({ messageId, project: project.name, recipient: resolvedRecipient }, 'Message queued');
    res.status(202).json({
        id: messageId,
        status: 'queued',
        project: project.name,
        recipient: resolvedRecipient,
    });
});
//# sourceMappingURL=messages.js.map