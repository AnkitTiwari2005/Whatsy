import { Router, Request, Response } from 'express';
import { getStatus, getQueueLength } from '../whatsapp/client';

export const statusRouter = Router();

// Public by design (uptime monitors). Exposes only coarse state — no numbers, projects or message data.
statusRouter.get('/', (_req: Request, res: Response): void => {
  const { status, uptime_seconds } = getStatus();
  res.json({ whatsapp: status, uptime_seconds, queue_length: getQueueLength() });
});
