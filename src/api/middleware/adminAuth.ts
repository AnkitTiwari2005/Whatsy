import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../../config';

export function adminKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const provided = req.headers['x-admin-key'] as string | undefined;

  if (!provided) {
    res.status(401).json({ error: 'Invalid or missing X-Admin-Key header' });
    return;
  }

  // Pre-hash both strings to SHA-256 to ensure equal-length 32-byte buffers for constant-time comparison
  const providedHash = crypto.createHash('sha256').update(provided).digest();
  const expectedHash = crypto.createHash('sha256').update(config.adminKey).digest();

  if (!crypto.timingSafeEqual(providedHash, expectedHash)) {
    res.status(401).json({ error: 'Invalid or missing X-Admin-Key header' });
    return;
  }

  next();
}