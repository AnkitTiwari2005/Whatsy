import { Router, Request, Response } from 'express';
import { requestPairing, getStatus, getQueueLength, unlinkSession } from '../../whatsapp/client';
import { logger } from '../../logger';
import { HttpError } from '../../util/http';
import { normalizePhone } from '../../util/phone';

export const pairRouter = Router();

// GET /admin/pair/status — everything the console needs to render the pairing wizard (polled by the UI)
pairRouter.get('/status', (_req: Request, res: Response): void => {
  res.json({ ...getStatus(), queue_length: getQueueLength() });
});

pairRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const raw = req.body?.phone_number ?? req.body?.phone ?? req.body?.recipient;
  const p = normalizePhone(raw);
  if (!p.ok) throw new HttpError(400, 'invalid_phone', `phone_number ${p.error}`);
  const code = await requestPairing(p.digits);
  logger.info('Pairing code issued');
  res.json({
    pairing_code: code,
    instructions: [
      'Open WhatsApp on your phone',
      'Go to Settings → Linked Devices → Link a Device',
      'Tap "Link with phone number instead"',
      'Enter the pairing code shown here',
      'Wait about 10 seconds — this page updates automatically when linked',
    ],
  });
});

// POST /admin/pair/unlink — log out and remove the stored session so a different number can be paired
pairRouter.post('/unlink', async (_req: Request, res: Response): Promise<void> => {
  await unlinkSession();
  res.json({ ok: true, message: 'Session removed. You can pair a number now.' });
});

export default pairRouter;
