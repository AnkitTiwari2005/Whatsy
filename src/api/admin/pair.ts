import { Router, Request, Response } from 'express';
import { requestPairing, getStatus } from '../../whatsapp/client';
import { logger } from '../../logger';

export const pairRouter = Router();

pairRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const { phone_number } = req.body as { phone_number?: string };

  if (!phone_number) {
    res.status(400).json({
      error: 'phone_number is required (digits only, e.g. "919876543210")',
    });
    return;
  }

  const { status } = getStatus();
  if (status === 'connected') {
    res.status(409).json({
      error: 'WhatsApp is already connected. Pairing is only needed for fresh or logged-out sessions.',
    });
    return;
  }

  try {
    const code = await requestPairing(phone_number);
    logger.info({ phone: phone_number }, 'Pairing code issued');
    res.json({
      pairing_code: code,
      instructions: [
        '1. Open WhatsApp on your phone',
        '2. Go to Settings -> Linked Devices -> Link a Device',
        '3. Tap "Link with phone number instead"',
        '4. Enter the pairing code above',
        '5. Wait ~10 seconds — the server will log "WhatsApp connected" when done',
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, 'Pairing failed');
    res.status(500).json({ error: message });
  }
});

export default pairRouter;