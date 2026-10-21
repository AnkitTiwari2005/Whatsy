import { Router, Request, Response } from 'express';
import { getDb, MessageRow } from '../../db';
import { HttpError, isoUtc } from '../../util/http';
import { normalizePhone } from '../../util/phone';
import { enqueueMessage, toJid } from '../../whatsapp/client';
import { config, REDACTED_BODY } from '../../config';

export const logsRouter = Router();
const STATUSES = ['queued', 'sent', 'failed'];

function intParam(v: unknown, name: string, def: number, min: number, max: number): number {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, 'invalid_param', `${name} must be an integer between ${min} and ${max}`);
  return n;
}
/** Query params may be repeated (?q=a&q=b → array); reject that instead of crashing with a 500. */
function oneStr(v: unknown, name: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_param', `${name} must be a single value`);
  return v;
}
const escLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

// GET /admin/messages?project=&status=&q=&limit=&offset=&before_id=
logsRouter.get('/', (req: Request, res: Response): void => {
  const raw = req.query as Record<string, unknown>;
  const q = { project: oneStr(raw.project, 'project'), status: oneStr(raw.status, 'status'), q: oneStr(raw.q, 'q'),
    limit: oneStr(raw.limit, 'limit'), offset: oneStr(raw.offset, 'offset'), before_id: oneStr(raw.before_id, 'before_id') };
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

// GET /admin/messages/:id — one message (lets the console poll a specific row instead of guessing it is in the latest page)
logsRouter.get('/:id', (req: Request, res: Response): void => {
  const m = getDb().prepare('SELECT m.*, p.name AS project_name FROM messages m JOIN projects p ON p.id = m.project_id WHERE m.id = ?').get(Number(req.params.id)) as (MessageRow & { project_name: string }) | undefined;
  if (!m) throw new HttpError(404, 'not_found', 'Message not found');
  res.json({ ...m, created_at: isoUtc(m.created_at), sent_at: isoUtc(m.sent_at) });
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

// POST /admin/messages/test — send a test WhatsApp message directly from the admin console
logsRouter.post('/test', (req: Request, res: Response): void => {
  const { recipient, phone, phone_number, message, project_id } = req.body as {
    recipient?: unknown;
    phone?: unknown;
    phone_number?: unknown;
    message?: unknown;
    project_id?: unknown;
  };
  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new HttpError(400, 'invalid_message', 'message is required and must be a non-empty string');
  }
  const rawTarget = recipient ?? phone ?? phone_number;
  if (!rawTarget) {
    throw new HttpError(400, 'missing_recipient', 'recipient is required');
  }
  const p = normalizePhone(rawTarget);
  if (!p.ok) {
    throw new HttpError(400, 'invalid_recipient', `recipient ${p.error}`);
  }
  const text = message.trim();
  if (text.length > config.maxMessageLength) throw new HttpError(400, 'message_too_long', `message must be at most ${config.maxMessageLength} characters (got ${text.length})`);
  const db = getDb();
  let project: { id: number; name: string } | undefined;
  if (project_id !== undefined && project_id !== null && project_id !== '') {
    project = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(Number(project_id)) as any;
    if (!project) throw new HttpError(404, 'not_found', 'Project not found');   // never silently fall back to a different project
  } else {
    project = db.prepare('SELECT id, name FROM projects ORDER BY id ASC LIMIT 1').get() as any;
  }
  if (!project) {
    throw new HttpError(400, 'no_project', 'No project found. Please create a project first.');
  }

  const id = db.prepare(`INSERT INTO messages (project_id, recipient, body, status) VALUES (?, ?, ?, 'queued')`)
    .run(project.id, p.e164, config.redactBodies ? REDACTED_BODY : text).lastInsertRowid as number;   // honour REDACT_BODIES here too

  try {
    enqueueMessage({ messageId: id, recipient: toJid(p.digits), body: text });
  } catch (err) {
    const e = err instanceof Error ? err.message : String(err);
    db.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).run(e, id);
    throw err;
  }

  res.status(202).json({ id, status: 'queued', recipient: p.e164, project: project.name });
});
