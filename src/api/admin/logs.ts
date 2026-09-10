import { Router, Request, Response } from 'express';
import { getDb, MessageRow } from '../../db';

export const logsRouter = Router();

logsRouter.get('/', (req: Request, res: Response): void => {
  const db = getDb();
  const { project, status, limit = '50', offset = '0' } = req.query as {
    project?: string;
    status?: string;
    limit?: string;
    offset?: string;
  };

  const limitNum = Math.min(parseInt(limit, 10) || 50, 500);
  const offsetNum = parseInt(offset, 10) || 0;

  let query = `
    SELECT m.*, p.name as project_name
    FROM messages m
    JOIN projects p ON p.id = m.project_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

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

  const rows = db.prepare(query).all(...params) as (MessageRow & { project_name: string })[];

  let countQuery = `
    SELECT COUNT(*) as total FROM messages m
    JOIN projects p ON p.id = m.project_id WHERE 1=1
  `;
  const countParams: (string | number)[] = [];
  if (project) { countQuery += ' AND p.name = ?'; countParams.push(project); }
  if (status && ['queued', 'sent', 'failed'].includes(status)) {
    countQuery += ' AND m.status = ?'; countParams.push(status);
  }
  const { total } = db.prepare(countQuery).get(...countParams) as { total: number };

  res.json({ total, limit: limitNum, offset: offsetNum, messages: rows });
});