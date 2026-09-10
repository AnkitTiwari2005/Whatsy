import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import rateLimit from 'express-rate-limit';

import { adminKeyAuth } from './api/middleware/adminAuth';
import { messagesRouter } from './api/messages';
import { statusRouter } from './api/status';
import { projectsRouter } from './api/admin/projects';
import { logsRouter } from './api/admin/logs';
import pairRouter from './api/admin/pair';

export function createApp() {
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: '64kb' }));

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, slow down' },
  });

  // Public status — no auth, useful for uptime monitoring
  app.use('/api/v1/status', statusRouter);

  // Message sending — API key auth applied inside router
  app.use('/api/v1/messages', apiLimiter, messagesRouter);

  // Admin routes — ADMIN_KEY required
  app.use('/admin/projects', adminKeyAuth, projectsRouter);
  app.use('/admin/messages', adminKeyAuth, logsRouter);
  app.use('/admin/pair', adminKeyAuth, pairRouter);

  // Admin UI — static HTML
  app.use('/admin/ui', express.static(path.join(__dirname, 'admin-ui')));
  app.get('/admin', (_req, res) => res.redirect('/admin/ui'));

  // Health check
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // 404
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}