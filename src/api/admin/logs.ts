import { Router, Request, Response } from 'express';
import { getDb, MessageRow } from '../../db';
import { HttpError, isoUtc } from '../../util/http';
import { enqueueMessage, toJid } from '../../whatsapp/client';
import { REDACTED_BODY } from '../../config';

export const logsRouter = Router();
const STATUSES = ['queued', 'sent', 'failed'];

function intParam(v: unknown, name: string, def: number, min: number, max: number): number {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, 'invalid_param', `${name} must be an integer between ${min} and ${max}`);
  return n;
}
const escLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

// GET /admin/messages?project=&status=&q=&limit=&offset=&before_id=
logsRouter.get('/', (req: Request, res: Response): void => {
  const q = req.query as Record<string, string | undefined>;
  const limit = intParam(q.limit, 'limit', 50, 1, 500);
  const offset = intParam(q.offset, 'offset', 0, 0, 10_000_000);
  const beforeId = q.before_id !== undefined ? intParam(q.before_id, 'before_id', 0, 1, Number.MAX_SAFE_INTEGER) : null;
  if (q.status && !STATUSES.includes(q.status)) throw new HttpError(400, 'invalid_param', `status must be one of: ${STATUSES.join(', ')}`);
  if (q.q && q.q.length > 64) throw new HttpError(400, 'invalid_param', 'q must be at most 64 characters');

  const where: string[] = []; const params: Array<string | number> = [];
  if (q.project) { where.push('p.name = ?'); params.push(q.project); }
  if (q.status) { where.push('m.status = ?'); params.push(q.status); }
  if (q.q) { where.push(`(m.recipient LIKE ? ESCAPE '\\' OR m.body LIKE ? ESCAPE '\\')`); const l = `%${escLike(q.q)}%`; params.push(l, l); }
  const base = `FROM messages m JOIN projects p ON p.id = m.project_id`;
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const db = getDb();

  const { total } = db.prepare(`SELECT COUNT(*) AS total ${base}${w}`).get(...params) as { total: number };
  const pageWhere = beforeId ? (w ? w + ' AND m.id < ?' : ' WHERE m.id < ?') : w;
  const rows = db.prepare(`SELECT m.*, p.name AS project_name ${base}${pageWhere} ORDER BY m.id DESC LIMIT ? OFFSET ?`)
    .all(...params, ...(beforeId ? [beforeId] : []), limit + 1, beforeId ? 0 : offset) as Array<MessageRow & { project_name: string }>;
  const hasMore = rows.length > limit; if (hasMore) rows.pop();

  res.json({ total, limit, offset, has_more: hasMore, messages: rows.map((m) => ({ ...m, created_at: isoUtc(m.created_at), sent_at: isoUtc(m.sent_at) })) });
});

// GET /admin/messages/stats — last 24h counts for the dashboard
logsRouter.get('/stats', (_req: Request, res: Response): void => {
  const rows = getDb().prepare(`SELECT status, COUNT(*) AS n FROM messages WHERE created_at > datetime('now','-24 hours') GROUP BY status`).all() as Array<{ status: string; n: number }>;
  const out = { sent: 0, failed: 0, queued: 0 } as Record<string, number>;
  for (const r of rows) out[r.status] = r.n;
  res.json({ last_24h: out });
});

// POST /admin/messages/:id/retry — re-queue a failed message (not possible if its body was redacted)
logsRouter.post('/:id/retry', (req: Request, res: Response): void => {
  const db = getDb();
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(req.params.id)) as MessageRow | undefined;
  if (!m) throw new HttpError(404, 'not_found', 'Message not found');
  if (m.status !== 'failed') throw new HttpError(409, 'not_failed', 'Only failed messages can be retried');
  if (m.body === REDACTED_BODY) throw new HttpError(409, 'not_retryable', 'This message body was redacted and cannot be re-sent');
  db.prepare(`UPDATE messages SET status='queued', error=NULL WHERE id=?`).run(m.id);
  try { enqueueMessage({ messageId: m.id, recipient: toJid(m.recipient), body: m.body }); }
  catch (e) { db.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).run((e as Error).message, m.id); throw e; }
  res.status(202).json({ id: m.id, status: 'queued' });
});
