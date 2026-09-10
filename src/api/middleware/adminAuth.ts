import { Request, Response, NextFunction } from 'express';
import { config } from '../../config';

export function adminKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const provided = req.headers['x-admin-key'] as string | undefined;

  if (!provided || provided !== config.adminKey) {
    res.status(401).json({ error: 'Invalid or missing X-Admin-Key header' });
    return;
  }

  next();
}