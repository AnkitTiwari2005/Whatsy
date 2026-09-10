import { Router, Request, Response } from 'express';
import { apiKeyAuth } from './middleware/auth';
import { getDb } from '../db';
import { enqueueMessage, getStatus, toJid } from '../whatsapp/client';
import { config } from '../config';
import { logger } from '../logger';

export const messagesRouter = Router();

messagesRouter.post('/', apiKeyAuth, async (req: Request, res: Response): Promise<void> => {
  const { message, recipient } = req.body as { message?: string; recipient?: string };
  const project = req.project!;

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

  const { status } = getStatus();
  if (status === 'disconnected') {
    logger.warn({ projectId: project.id }, 'Queuing message while WhatsApp disconnected');
  }

  const db = getDb();
  const loggedBody = config.redactBodies ? '[redacted]' : message.trim();

  const result = db
    .prepare(
      `INSERT INTO messages (project_id, recipient, body, status)
       VALUES (?, ?, ?, 'queued')`
    )
    .run(project.id, resolvedRecipient, loggedBody);

  const messageId = result.lastInsertRowid as number;

  try {
    enqueueMessage({
      messageId,
      recipient: toJid(resolvedRecipient),
      body: message.trim(),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    db.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).run(error, messageId);
    res.status(503).json({ error });
    return;
  }

  logger.info({ messageId, project: project.name, recipient: resolvedRecipient }, 'Message queued');

  res.status(202).json({
    id: messageId,
    status: 'queued',
    project: project.name,
    recipient: resolvedRecipient,
  });
});