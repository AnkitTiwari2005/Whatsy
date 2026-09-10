"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectsRouter = void 0;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../../db");
const logger_1 = require("../../logger");
exports.projectsRouter = (0, express_1.Router)();
// List all projects
exports.projectsRouter.get('/', (_req, res) => {
    const db = (0, db_1.getDb)();
    const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    const result = projects.map((p) => {
        const keys = db
            .prepare(`SELECT id, key_prefix, label, active, created_at, last_used_at
         FROM api_keys WHERE project_id = ? ORDER BY created_at DESC`)
            .all(p.id);
        return { ...p, api_keys: keys };
    });
    res.json(result);
});
// Create project
exports.projectsRouter.post('/', (req, res) => {
    const { name, description, default_recipient } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'name is required' });
        return;
    }
    const db = (0, db_1.getDb)();
    try {
        const projectResult = db
            .prepare(`INSERT INTO projects (name, description, default_recipient) VALUES (?, ?, ?)`)
            .run(name.trim(), description ?? null, default_recipient ?? null);
        const projectId = projectResult.lastInsertRowid;
        const { rawKey, prefix, hash } = generateApiKey();
        db.prepare(`INSERT INTO api_keys (project_id, key_hash, key_prefix, label) VALUES (?, ?, ?, 'default')`).run(projectId, hash, prefix);
        logger_1.logger.info({ projectId, name: name.trim() }, 'Project created');
        res.status(201).json({
            id: projectId,
            name: name.trim(),
            description: description ?? null,
            default_recipient: default_recipient ?? null,
            api_key: rawKey,
            api_key_prefix: prefix,
            note: 'Save this API key — it will not be shown again.',
        });
    }
    catch (err) {
        if (err?.message?.includes('UNIQUE constraint')) {
            res.status(409).json({ error: `Project with name "${name}" already exists` });
            return;
        }
        throw err;
    }
});
// Update project
exports.projectsRouter.patch('/:id', (req, res) => {
    const { id } = req.params;
    const { description, default_recipient, active } = req.body;
    const db = (0, db_1.getDb)();
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
    }
    db.prepare(`UPDATE projects SET
       description = COALESCE(?, description),
       default_recipient = COALESCE(?, default_recipient),
       active = COALESCE(?, active)
     WHERE id = ?`).run(description ?? null, default_recipient ?? null, active !== undefined ? (active ? 1 : 0) : null, id);
    res.json({ ok: true });
});
// Add API key
exports.projectsRouter.post('/:id/keys', async (req, res) => {
    const { id } = req.params;
    const { label } = req.body;
    const db = (0, db_1.getDb)();
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND active = 1').get(id);
    if (!project) {
        res.status(404).json({ error: 'Project not found or inactive' });
        return;
    }
    const { rawKey, prefix, hash } = generateApiKey();
    db.prepare(`INSERT INTO api_keys (project_id, key_hash, key_prefix, label) VALUES (?, ?, ?, ?)`).run(project.id, hash, prefix, label ?? null);
    logger_1.logger.info({ projectId: project.id, prefix }, 'API key created');
    res.status(201).json({
        api_key: rawKey,
        api_key_prefix: prefix,
        label: label ?? null,
        note: 'Save this API key — it will not be shown again.',
    });
});
// Revoke API key
exports.projectsRouter.delete('/:id/keys/:keyId', (req, res) => {
    const { id, keyId } = req.params;
    const db = (0, db_1.getDb)();
    const result = db
        .prepare(`UPDATE api_keys SET active = 0 WHERE id = ? AND project_id = ? AND active = 1`)
        .run(keyId, id);
    if (result.changes === 0) {
        res.status(404).json({ error: 'Key not found or already revoked' });
        return;
    }
    logger_1.logger.info({ projectId: id, keyId }, 'API key revoked');
    res.json({ ok: true, message: 'Key revoked. Existing requests using this key will be rejected immediately.' });
});
// Generate a 32-byte random API key
function generateApiKey() {
    const rawKey = crypto_1.default.randomBytes(32).toString('base64url');
    const prefix = rawKey.slice(0, 8);
    const hash = bcryptjs_1.default.hashSync(rawKey, 10);
    return { rawKey, prefix, hash };
}
//# sourceMappingURL=projects.js.map