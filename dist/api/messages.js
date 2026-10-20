"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messagesRouter = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const client_1 = require("../whatsapp/client");
const config_1 = require("../config");
const logger_1 = require("../logger");
const http_1 = require("../util/http");
const phone_1 = require("../util/phone");
exports.messagesRouter = (0, express_1.Router)();
const view = (m) => ({
    id: m.id, status: m.status, recipient: m.recipient, error: m.error,
    created_at: (0, http_1.isoUtc)(m.created_at), sent_at: (0, http_1.isoUtc)(m.sent_at), wa_message_id: m.wa_message_id,
});
// POST /api/v1/messages  — optional "Idempotency-Key" header makes client retries safe (no duplicate WhatsApp messages).
exports.messagesRouter.post('/', (req, res) => {
    const { message, recipient, phone: phoneAlias, phone_number } = req.body;
    const project = req.project;
    if (typeof message !== 'string' || message.trim().length === 0)
        throw new http_1.HttpError(400, 'invalid_message', 'message is required and must be a non-empty string');
    const text = message.trim();
    if (text.length > config_1.config.maxMessageLength)
        throw new http_1.HttpError(400, 'message_too_long', `message must be at most ${config_1.config.maxMessageLength} characters (got ${text.length})`);
    const raw = recipient ?? phoneAlias ?? phone_number ?? project.default_recipient;
    if (raw === undefined || raw === null || raw === '')
        throw new http_1.HttpError(400, 'missing_recipient', 'recipient is required — this project has no default_recipient configured');
    const phone = (0, phone_1.normalizePhone)(raw);
    if (!phone.ok)
        throw new http_1.HttpError(400, 'invalid_recipient', `recipient ${phone.error}`);
    const idemKey = req.header('idempotency-key')?.trim();
    if (idemKey && idemKey.length > 128)
        throw new http_1.HttpError(400, 'invalid_idempotency_key', 'Idempotency-Key must be at most 128 characters');
    const db = (0, db_1.getDb)();
    if (idemKey) {
        const prior = db.prepare('SELECT * FROM messages WHERE project_id = ? AND idempotency_key = ?').get(project.id, idemKey);
        if (prior) {
            res.status(200).json({ ...view(prior), project: project.name, idempotent_replay: true });
            return;
        }
    }
    if ((0, client_1.getStatus)().status === 'disconnected')
        logger_1.logger.warn({ projectId: project.id }, 'Queuing message while WhatsApp disconnected');
    const id = db.prepare(`INSERT INTO messages (project_id, recipient, body, status, idempotency_key) VALUES (?, ?, ?, 'queued', ?)`)
        .run(project.id, phone.e164, config_1.config.redactBodies ? config_1.REDACTED_BODY : text, idemKey || null).lastInsertRowid;
    try {
        (0, client_1.enqueueMessage)({ messageId: id, recipient: (0, client_1.toJid)(phone.digits), body: text });
    }
    catch (err) {
        const e = err instanceof Error ? err.message : String(err);
        db.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).run(e, id);
        if (err instanceof http_1.HttpError)
            res.set('Retry-After', '30');
        throw err;
    }
    logger_1.logger.info({ messageId: id, project: project.name }, 'Message queued');
    res.status(202).json({ id, status: 'queued', project: project.name, recipient: phone.e164 });
});
// GET /api/v1/messages/:id — poll delivery status (scoped to the calling project)
exports.messagesRouter.get('/:id', (req, res) => {
    const row = (0, db_1.getDb)().prepare('SELECT * FROM messages WHERE id = ? AND project_id = ?').get(Number(req.params.id), req.project.id);
    if (!row)
        throw new http_1.HttpError(404, 'not_found', 'Message not found');
    res.json(view(row));
});
//# sourceMappingURL=messages.js.map