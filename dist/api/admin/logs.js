"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logsRouter = void 0;
const express_1 = require("express");
const db_1 = require("../../db");
const http_1 = require("../../util/http");
const phone_1 = require("../../util/phone");
const client_1 = require("../../whatsapp/client");
const config_1 = require("../../config");
exports.logsRouter = (0, express_1.Router)();
const STATUSES = ['queued', 'sent', 'failed'];
function intParam(v, name, def, min, max) {
    if (v === undefined || v === '')
        return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max)
        throw new http_1.HttpError(400, 'invalid_param', `${name} must be an integer between ${min} and ${max}`);
    return n;
}
const escLike = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);
// GET /admin/messages?project=&status=&q=&limit=&offset=&before_id=
exports.logsRouter.get('/', (req, res) => {
    const q = req.query;
    const limit = intParam(q.limit, 'limit', 50, 1, 500);
    const offset = intParam(q.offset, 'offset', 0, 0, 10_000_000);
    const beforeId = q.before_id !== undefined ? intParam(q.before_id, 'before_id', 0, 1, Number.MAX_SAFE_INTEGER) : null;
    if (q.status && !STATUSES.includes(q.status))
        throw new http_1.HttpError(400, 'invalid_param', `status must be one of: ${STATUSES.join(', ')}`);
    if (q.q && q.q.length > 64)
        throw new http_1.HttpError(400, 'invalid_param', 'q must be at most 64 characters');
    const where = [];
    const params = [];
    if (q.project) {
        where.push('p.name = ?');
        params.push(q.project);
    }
    if (q.status) {
        where.push('m.status = ?');
        params.push(q.status);
    }
    if (q.q) {
        where.push(`(m.recipient LIKE ? ESCAPE '\\' OR m.body LIKE ? ESCAPE '\\')`);
        const l = `%${escLike(q.q)}%`;
        params.push(l, l);
    }
    const base = `FROM messages m JOIN projects p ON p.id = m.project_id`;
    const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const db = (0, db_1.getDb)();
    const { total } = db.prepare(`SELECT COUNT(*) AS total ${base}${w}`).get(...params);
    const pageWhere = beforeId ? (w ? w + ' AND m.id < ?' : ' WHERE m.id < ?') : w;
    const rows = db.prepare(`SELECT m.*, p.name AS project_name ${base}${pageWhere} ORDER BY m.id DESC LIMIT ? OFFSET ?`)
        .all(...params, ...(beforeId ? [beforeId] : []), limit + 1, beforeId ? 0 : offset);
    const hasMore = rows.length > limit;
    if (hasMore)
        rows.pop();
    res.json({ total, limit, offset, has_more: hasMore, messages: rows.map((m) => ({ ...m, created_at: (0, http_1.isoUtc)(m.created_at), sent_at: (0, http_1.isoUtc)(m.sent_at) })) });
});
// GET /admin/messages/stats — last 24h counts for the dashboard
exports.logsRouter.get('/stats', (_req, res) => {
    const rows = (0, db_1.getDb)().prepare(`SELECT status, COUNT(*) AS n FROM messages WHERE created_at > datetime('now','-24 hours') GROUP BY status`).all();
    const out = { sent: 0, failed: 0, queued: 0 };
    for (const r of rows)
        out[r.status] = r.n;
    res.json({ last_24h: out });
});
// POST /admin/messages/:id/retry — re-queue a failed message (not possible if its body was redacted)
exports.logsRouter.post('/:id/retry', (req, res) => {
    const db = (0, db_1.getDb)();
    const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(req.params.id));
    if (!m)
        throw new http_1.HttpError(404, 'not_found', 'Message not found');
    if (m.status !== 'failed')
        throw new http_1.HttpError(409, 'not_failed', 'Only failed messages can be retried');
    if (m.body === config_1.REDACTED_BODY)
        throw new http_1.HttpError(409, 'not_retryable', 'This message body was redacted and cannot be re-sent');
    db.prepare(`UPDATE messages SET status='queued', error=NULL WHERE id=?`).run(m.id);
    try {
        (0, client_1.enqueueMessage)({ messageId: m.id, recipient: (0, client_1.toJid)(m.recipient), body: m.body });
    }
    catch (e) {
        db.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).run(e.message, m.id);
        throw e;
    }
    res.status(202).json({ id: m.id, status: 'queued' });
});
// POST /admin/messages/test — send a test WhatsApp message directly from the admin console
exports.logsRouter.post('/test', (req, res) => {
    const { recipient, phone, phone_number, message, project_id } = req.body;
    if (typeof message !== 'string' || message.trim().length === 0) {
        throw new http_1.HttpError(400, 'invalid_message', 'message is required and must be a non-empty string');
    }
    const rawTarget = recipient ?? phone ?? phone_number;
    if (!rawTarget) {
        throw new http_1.HttpError(400, 'missing_recipient', 'recipient is required');
    }
    const p = (0, phone_1.normalizePhone)(rawTarget);
    if (!p.ok) {
        throw new http_1.HttpError(400, 'invalid_recipient', `recipient ${p.error}`);
    }
    const text = message.trim();
    const db = (0, db_1.getDb)();
    let project;
    if (project_id) {
        project = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(Number(project_id));
    }
    if (!project) {
        project = db.prepare('SELECT id, name FROM projects ORDER BY id ASC LIMIT 1').get();
    }
    if (!project) {
        throw new http_1.HttpError(400, 'no_project', 'No project found. Please create a project first.');
    }
    const id = db.prepare(`INSERT INTO messages (project_id, recipient, body, status) VALUES (?, ?, ?, 'queued')`)
        .run(project.id, p.e164, text).lastInsertRowid;
    try {
        (0, client_1.enqueueMessage)({ messageId: id, recipient: (0, client_1.toJid)(p.digits), body: text });
    }
    catch (err) {
        const e = err instanceof Error ? err.message : String(err);
        db.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).run(e, id);
        throw err;
    }
    res.status(202).json({ id, status: 'queued', recipient: p.e164, project: project.name });
});
//# sourceMappingURL=logs.js.map