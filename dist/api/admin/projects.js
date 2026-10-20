"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectsRouter = void 0;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../../db");
const logger_1 = require("../../logger");
const http_1 = require("../../util/http");
const phone_1 = require("../../util/phone");
const auth_1 = require("../middleware/auth");
exports.projectsRouter = (0, express_1.Router)();
function cleanName(v) {
    if (typeof v !== 'string')
        throw new http_1.HttpError(400, 'invalid_name', 'name is required');
    const n = v.trim().replace(/\s+/g, ' ');
    if (n.length < 1 || n.length > 64)
        throw new http_1.HttpError(400, 'invalid_name', 'name must be 1–64 characters');
    if (/[\u0000-\u001f<>]/.test(n))
        throw new http_1.HttpError(400, 'invalid_name', 'name contains invalid characters');
    return n;
}
function cleanDescription(v) {
    if (v === null || v === undefined || v === '')
        return null;
    if (typeof v !== 'string' || v.trim().length > 280)
        throw new http_1.HttpError(400, 'invalid_description', 'description must be text of at most 280 characters');
    return v.trim();
}
function cleanRecipient(v) {
    if (v === null || v === undefined || v === '')
        return null;
    const p = (0, phone_1.normalizePhone)(v);
    if (!p.ok)
        throw new http_1.HttpError(400, 'invalid_recipient', `default_recipient ${p.error}`);
    return p.e164;
}
function cleanLabel(v) {
    if (v === null || v === undefined || v === '')
        return null;
    if (typeof v !== 'string' || v.trim().length > 64)
        throw new http_1.HttpError(400, 'invalid_label', 'label must be at most 64 characters');
    return v.trim();
}
function nameTaken(name, exceptId) {
    return !!(0, db_1.getDb)().prepare('SELECT id FROM projects WHERE lower(trim(name)) = lower(?) AND id != ?').get(name, exceptId ?? -1);
}
function newKey() {
    const rawKey = crypto_1.default.randomBytes(32).toString('base64url');
    return { rawKey, prefix: rawKey.slice(0, 8), hash: (0, auth_1.hashApiKey)(rawKey) };
}
const projectView = (p, keys) => ({
    ...p, created_at: (0, http_1.isoUtc)(p.created_at), active: p.active,
    api_keys: keys.map((k) => ({ ...k, created_at: (0, http_1.isoUtc)(k.created_at), last_used_at: (0, http_1.isoUtc)(k.last_used_at) })),
});
exports.projectsRouter.get('/', (_req, res) => {
    const db = (0, db_1.getDb)();
    const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC, id DESC').all();
    const keyStmt = db.prepare(`SELECT id, key_prefix, label, active, created_at, last_used_at FROM api_keys WHERE project_id = ? ORDER BY created_at DESC, id DESC`);
    res.json(projects.map((p) => projectView(p, keyStmt.all(p.id))));
});
exports.projectsRouter.post('/', (req, res) => {
    const name = cleanName(req.body.name);
    const description = cleanDescription(req.body.description);
    const recipient = cleanRecipient(req.body.default_recipient);
    if (nameTaken(name))
        throw new http_1.HttpError(409, 'name_taken', `A project named "${name}" already exists`);
    const db = (0, db_1.getDb)();
    const { rawKey, prefix, hash } = newKey();
    try {
        const projectId = db.transaction(() => {
            const id = db.prepare('INSERT INTO projects (name, description, default_recipient) VALUES (?, ?, ?)').run(name, description, recipient).lastInsertRowid;
            db.prepare(`INSERT INTO api_keys (project_id, key_hash, key_prefix, label) VALUES (?, ?, ?, 'default')`).run(id, hash, prefix);
            return id;
        })();
        logger_1.logger.info({ projectId, name }, 'Project created');
        res.status(201).json({ id: projectId, name, description, default_recipient: recipient, api_key: rawKey, api_key_prefix: prefix, note: 'Save this API key — it will not be shown again.' });
    }
    catch (err) {
        if (String(err?.message).includes('UNIQUE'))
            throw new http_1.HttpError(409, 'name_taken', `A project named "${name}" already exists`);
        throw err;
    }
});
exports.projectsRouter.patch('/:id', (req, res) => {
    const db = (0, db_1.getDb)();
    const id = Number(req.params.id);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project)
        throw new http_1.HttpError(404, 'not_found', 'Project not found');
    const b = req.body;
    const sets = [];
    const vals = [];
    if ('name' in b) {
        const n = cleanName(b.name);
        if (nameTaken(n, id))
            throw new http_1.HttpError(409, 'name_taken', `A project named "${n}" already exists`);
        sets.push('name = ?');
        vals.push(n);
    }
    if ('description' in b) {
        sets.push('description = ?');
        vals.push(cleanDescription(b.description));
    }
    if ('default_recipient' in b) {
        sets.push('default_recipient = ?');
        vals.push(cleanRecipient(b.default_recipient));
    }
    if ('active' in b) {
        if (typeof b.active !== 'boolean')
            throw new http_1.HttpError(400, 'invalid_active', 'active must be true or false');
        sets.push('active = ?');
        vals.push(b.active ? 1 : 0);
    }
    if (sets.length === 0)
        throw new http_1.HttpError(400, 'nothing_to_update', 'Provide at least one of: name, description, default_recipient, active');
    db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    res.json({ ok: true });
});
exports.projectsRouter.post('/:id/keys', (req, res) => {
    const db = (0, db_1.getDb)();
    const project = db.prepare('SELECT id, active FROM projects WHERE id = ?').get(Number(req.params.id));
    if (!project)
        throw new http_1.HttpError(404, 'not_found', 'Project not found');
    if (!project.active)
        throw new http_1.HttpError(409, 'project_inactive', 'Project is deactivated — activate it before creating keys');
    const label = cleanLabel(req.body.label);
    const { rawKey, prefix, hash } = newKey();
    db.prepare('INSERT INTO api_keys (project_id, key_hash, key_prefix, label) VALUES (?, ?, ?, ?)').run(project.id, hash, prefix, label);
    logger_1.logger.info({ projectId: project.id, prefix }, 'API key created');
    res.status(201).json({ api_key: rawKey, api_key_prefix: prefix, label, note: 'Save this API key — it will not be shown again.' });
});
exports.projectsRouter.delete('/:id/keys/:keyId', (req, res) => {
    const r = (0, db_1.getDb)().prepare('UPDATE api_keys SET active = 0 WHERE id = ? AND project_id = ? AND active = 1').run(Number(req.params.keyId), Number(req.params.id));
    if (r.changes === 0)
        throw new http_1.HttpError(404, 'not_found', 'Key not found or already revoked');
    logger_1.logger.info({ projectId: req.params.id, keyId: req.params.keyId }, 'API key revoked');
    res.json({ ok: true, message: 'Key revoked. Requests using this key are rejected immediately.' });
});
//# sourceMappingURL=projects.js.map