import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../../config';
import { logger } from '../../logger';
import { FailureLimiter } from './failureLimiter';

const failures = new FailureLimiter(config.adminFailMax, config.adminFailWindowSec * 1000);
const expected = crypto.createHash('sha256').update(config.adminKey).digest();

/** Admin auth: constant-time compare + lockout of an IP after repeated wrong keys (even if a later guess is right). */
export function adminKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || 'unknown';
  const wait = failures.retryAfter(ip);
  if (wait > 0) {
    res.set('Retry-After', String(wait));
    res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`, code: 'too_many_attempts', retry_after_seconds: wait });
    return;
  }
  const provided = req.header('x-admin-key');
  const ok = !!provided && crypto.timingSafeEqual(crypto.createHash('sha256').update(provided).digest(), expected);
  if (!ok) {
    failures.fail(ip);
    logger.warn({ ip }, 'Failed admin authentication');
    res.status(401).json({ error: 'Invalid or missing X-Admin-Key header', code: 'unauthorized' });
    return;
  }
  next();
}
