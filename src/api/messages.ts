import { Router, Request, Response } from 'express';
import { getDb, MessageRow } from '../db';
import { enqueueMessage, getStatus, toJid } from '../whatsapp/client';
import { config, REDACTED_BODY } from '../config';
import { logger } from '../logger';
import { HttpError, isoUtc } from '../util/http';
import { normalizePhone } from '../util/phone';

export const messagesRouter = Router();

const view = (m: MessageRow) => ({
  id: m.id, status: m.status, recipient: m.recipient, error: m.error,
  created_at: isoUtc(m.created_at), sent_at: isoUtc(m.sent_at), wa_message_id: m.wa_message_id,
});

// POST /api/v1/messages  — optional "Idempotency-Key" header makes client retries safe (no duplicate WhatsApp messages).
messagesRouter.post('/', (req: Request, res: Response): void => {
  const { message, recipient, phone: phoneAlias, phone_number } = req.body as {
    message?: unknown;
    recipient?: unknown;
    phone?: unknown;
    phone_number?: unknown;
  };
  const project = req.project!;

  if (typeof message !== 'string' || message.trim().length === 0) throw new HttpError(400, 'invalid_message', 'message is required and must be a non-empty string');
  const text = message.trim();
  if (text.length > config.maxMessageLength) throw new HttpError(400, 'message_too_long', `message must be at most ${config.maxMessageLength} characters (got ${text.length})`);

  const raw = recipient ?? phoneAlias ?? phone_number ?? project.default_recipient;
  if (raw === undefined || raw === null || raw === '') throw new HttpError(400, 'missing_recipient', 'recipient is required — this project has no default_recipient configured');
  const phone = normalizePhone(raw);
  if (!phone.ok) throw new HttpError(400, 'invalid_recipient', `recipient ${phone.error}`);

  const idemKey = req.header('idempotency-key')?.trim();
  if (idemKey && idemKey.length > 128) throw new HttpError(400, 'invalid_idempotency_key', 'Idempotency-Key must be at most 128 characters');

  const db = getDb();
  if (idemKey) {
    const prior = db.prepare('SELECT * FROM messages WHERE project_id = ? AND idempotency_key = ?').get(project.id, idemKey) as MessageRow | undefined;
    if (prior) { res.status(200).json({ ...view(prior), project: project.name, idempotent_replay: true }); return; }
  }

  if (getStatus().status === 'disconnected') logger.warn({ projectId: project.id }, 'Queuing message while WhatsApp disconnected');

  const id = db.prepare(`INSERT INTO messages (project_id, recipient, body, status, idempotency_key) VALUES (?, ?, ?, 'queued', ?)`)
    .run(project.id, phone.e164, config.redactBodies ? REDACTED_BODY : text, idemKey || null).lastInsertRowid as number;

  try {
    enqueueMessage({ messageId: id, recipient: toJid(phone.digits), body: text });
  } catch (err) {
    const e = err instanceof Error ? err.message : String(err);
    db.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).run(e, id);
    if (err instanceof HttpError) res.set('Retry-After', '30');
    throw err;
  }

  logger.info({ messageId: id, project: project.name }, 'Message queued');
  res.status(202).json({ id, status: 'queued', project: project.name, recipient: phone.e164 });
});

// GET /api/v1/messages/:id — poll delivery status (scoped to the calling project)
messagesRouter.get('/:id', (req: Request, res: Response): void => {
  const row = getDb().prepare('SELECT * FROM messages WHERE id = ? AND project_id = ?').get(Number(req.params.id), req.project!.id) as MessageRow | undefined;
  if (!row) throw new HttpError(404, 'not_found', 'Message not found');
  res.json(view(row));
});
