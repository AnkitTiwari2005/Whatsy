import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '../../db';
import { logger } from '../../logger';
import { FailureLimiter } from './failureLimiter';

declare global {
  namespace Express {
    interface Request {
      project?: { id: number; name: string; default_recipient: string | null; keyId: number };
    }
  }
}

export const KEY_HASH_PREFIX = 'sha256$';
/** API keys are 256-bit random values, so a fast hash is sufficient (bcrypt only protects low-entropy secrets). */
export const hashApiKey = (raw: string): string => KEY_HASH_PREFIX + crypto.createHash('sha256').update(raw).digest('hex');

const badKeyLimiter = new FailureLimiter(30, 5 * 60_000);

interface Row { id: number; key_hash: string; project_id: number; name: string; default_recipient: string | null }
const SELECT = `SELECT k.id, k.key_hash, k.project_id, p.name, p.default_recipient
                FROM api_keys k JOIN projects p ON p.id = k.project_id
                WHERE k.active = 1 AND p.active = 1 AND `;

/**
 * Resolve X-Api-Key → project. O(1) lookup by SHA-256. Legacy bcrypt keys are still accepted
 * and transparently upgraded to SHA-256 on first successful use.
 * Valid keys are never blocked by failed-attempt floods from the same IP; only *invalid* keys get 429.
 */
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const raw = req.header('x-api-key');
  const ip = req.ip || 'unknown';
  const db = getDb();
  let row: Row | undefined;

  if (raw && raw.length <= 256) {
    row = db.prepare(SELECT + 'k.key_hash = ?').get(hashApiKey(raw)) as Row | undefined;
    if (!row && !badKeyLimiter.retryAfter(ip)) {
      const candidates = db.prepare(SELECT + `k.key_prefix = ? AND k.key_hash NOT LIKE '${KEY_HASH_PREFIX}%'`).all(raw.slice(0, 8)) as Row[];
      for (const c of candidates) {
        if (await bcrypt.compare(raw, c.key_hash)) {
          row = c;
          try { db.prepare('UPDATE api_keys SET key_hash = ? WHERE id = ?').run(hashApiKey(raw), c.id); } catch (err) { logger.warn({ err }, 'Could not upgrade legacy key hash'); }
          break;
        }
      }
    }
  }

  if (!row) {
    if (!raw) { res.status(401).json({ error: 'Missing X-Api-Key header', code: 'missing_api_key' }); return; }
    const wait = badKeyLimiter.retryAfter(ip);
    badKeyLimiter.fail(ip);
    if (wait > 0) { res.set('Retry-After', String(wait)); res.status(429).json({ error: 'Too many invalid API keys from this address', code: 'too_many_attempts', retry_after_seconds: wait }); return; }
    logger.warn({ ip }, 'Invalid API key attempt');
    res.status(401).json({ error: 'Invalid or inactive API key', code: 'invalid_api_key' });
    return;
  }

  // Write at most once a minute per key instead of on every request.
  db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now','-60 seconds'))`).run(row.id);
  req.project = { id: row.project_id, name: row.name, default_recipient: row.default_recipient, keyId: row.id };
  next();
}
