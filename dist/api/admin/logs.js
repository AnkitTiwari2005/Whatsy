"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logsRouter = void 0;
const express_1 = require("express");
const db_1 = require("../../db");
exports.logsRouter = (0, express_1.Router)();
exports.logsRouter.get('/', (req, res) => {
    const db = (0, db_1.getDb)();
    const { project, status, limit = '50', offset = '0' } = req.query;
    const limitNum = Math.min(parseInt(limit, 10) || 50, 500);
    const offsetNum = parseInt(offset, 10) || 0;
    let query = `
    SELECT m.*, p.name as project_name
    FROM messages m
    JOIN projects p ON p.id = m.project_id
    WHERE 1=1
  `;
    const params = [];
    if (project) {
        query += ' AND p.name = ?';
        params.push(project);
    }
    if (status && ['queued', 'sent', 'failed'].includes(status)) {
        query += ' AND m.status = ?';
        params.push(status);
    }
    query += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offsetNum);
    const rows = db.prepare(query).all(...params);
    let countQuery = `
    SELECT COUNT(*) as total FROM messages m
    JOIN projects p ON p.id = m.project_id WHERE 1=1
  `;
    const countParams = [];
    if (project) {
        countQuery += ' AND p.name = ?';
        countParams.push(project);
    }
    if (status && ['queued', 'sent', 'failed'].includes(status)) {
        countQuery += ' AND m.status = ?';
        countParams.push(status);
    }
    const { total } = db.prepare(countQuery).get(...countParams);
    res.json({ total, limit: limitNum, offset: offsetNum, messages: rows });
});
//# sourceMappingURL=logs.js.map