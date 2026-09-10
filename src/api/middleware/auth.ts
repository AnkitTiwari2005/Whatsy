import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../../db';
import { logger } from '../../logger';

// Extend Express request to carry resolved project info after auth
declare global {
  namespace Express {
    interface Request {
      project?: {
        id: number;
        name: string;
        default_recipient: string | null;
        keyId: number;
      };
    }
  }
}

export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const rawKey = req.headers['x-api-key'] as string | undefined;

  if (!rawKey) {
    res.status(401).json({ error: 'Missing X-Api-Key header' });
    return;
  }

  const db = getDb();

  // Look up candidate keys by prefix (first 8 chars) to narrow the bcrypt search
  const prefix = rawKey.slice(0, 8);
  const candidates = db
    .prepare(
      `SELECT k.id, k.key_hash, k.project_id, k.active,
              p.name, p.default_recipient, p.active as project_active
       FROM api_keys k
       JOIN projects p ON p.id = k.project_id
       WHERE k.key_prefix = ? AND k.active = 1 AND p.active = 1`
    )
    .all(prefix) as Array<{
      id: number;
      key_hash: string;
      project_id: number;
      active: number;
      name: string;
      default_recipient: string | null;
      project_active: number;
    }>;

  for (const candidate of candidates) {
    const match = await bcrypt.compare(rawKey, candidate.key_hash);
    if (match) {
      db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`).run(
        candidate.id
      );
      req.project = {
        id: candidate.project_id,
        name: candidate.name,
        default_recipient: candidate.default_recipient,
        keyId: candidate.id,
      };
      next();
      return;
    }
  }

  logger.warn({ prefix }, 'Invalid API key attempt');
  res.status(401).json({ error: 'Invalid or inactive API key' });
}