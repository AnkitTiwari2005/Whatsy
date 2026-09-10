import { Router, Request, Response } from 'express';
import { getStatus, getQueueLength } from '../whatsapp/client';

export const statusRouter = Router();

statusRouter.get('/', (_req: Request, res: Response): void => {
  const { status, uptime_seconds } = getStatus();
  res.json({
    whatsapp: status,
    uptime_seconds,
    queue_length: getQueueLength(),
  });
});