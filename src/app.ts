import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { logger } from './logger';
import { dbHealthy } from './db';
import { HttpError } from './util/http';
import { getStatus } from './whatsapp/client';

import { adminKeyAuth } from './api/middleware/adminAuth';
import { apiKeyAuth } from './api/middleware/auth';
import { messagesRouter } from './api/messages';
import { otpRouter } from './api/otp';
import { statusRouter } from './api/status';
import { projectsRouter } from './api/admin/projects';
import { logsRouter } from './api/admin/logs';
import pairRouter from './api/admin/pair';

const limitJson = (message: string) => ({ error: message, code: 'rate_limited' });

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], fontSrc: ["'self'"], objectSrc: ["'none'"],
        baseUri: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"],
        'upgrade-insecure-requests': null,
      },
    },
  }));

  // Request id for support/debugging; echoed on every response and on 500 bodies.
  app.use((req, res, next) => { const id = crypto.randomUUID(); (req as any).id = id; res.set('X-Request-Id', id); next(); });

  // CORS is opt-in (CORS_ORIGINS=https://a.com,https://b.com). Server-to-server callers and the same-origin admin UI don't need it.
  if (config.corsOrigins.length) app.use('/api/v1', cors({ origin: config.corsOrigins }));

  app.use(express.json({ limit: '64kb' }));
  // Wrong/missing Content-Type → a clear 415/400 instead of an undefined req.body crash.
  app.use((req, res, next) => {
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
      const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'];
      if (hasBody && !req.is('application/json')) {
        res.status(415).json({ error: 'Content-Type must be application/json', code: 'unsupported_media_type' }); return;
      }
    }
    if (req.body === undefined || req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    next();
  });

  const ipLimiter = rateLimit({ windowMs: 60_000, limit: config.ipRatePerMin, standardHeaders: true, legacyHeaders: false, message: limitJson('Too many requests from this address') });
  // Per-project limits are applied AFTER authentication, so one noisy/hostile client cannot starve other projects.
  const perProject = (limit: number, label: string) => rateLimit({
    windowMs: 60_000, limit, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `p${req.project!.id}`,
    message: limitJson(`Rate limit for ${label} exceeded for this project`),
  });

  app.use('/api/v1/status', statusRouter);
  app.use('/api/v1/messages', ipLimiter, apiKeyAuth, perProject(config.messagesRatePerMin, 'messages'), messagesRouter);
  app.use('/api/v1/otp', ipLimiter, apiKeyAuth, perProject(config.otpRatePerMin, 'OTP'), otpRouter);

  app.use('/admin/projects', adminKeyAuth, projectsRouter);
  app.use('/admin/messages', adminKeyAuth, logsRouter);
  app.use('/admin/pair', adminKeyAuth, pairRouter);

  app.use('/admin/ui', express.static(path.join(__dirname, 'admin-ui'), {
    maxAge: '1h',
    setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
  }));
  app.get('/admin', (_req, res) => res.redirect('/admin/ui/'));

  app.get('/health', (_req, res) => {
    const db = dbHealthy();
    res.status(db ? 200 : 503).json({ ok: db, db, whatsapp: getStatus().status });
  });

  app.use((_req, res) => res.status(404).json({ error: 'Not found', code: 'not_found' }));

  // Central error handler: client mistakes are 4xx, only genuine faults are 500 (with a request id to quote).
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message, code: err.code, ...err.extra }); return; }
    if (err?.type === 'entity.parse.failed') { res.status(400).json({ error: 'Request body is not valid JSON', code: 'invalid_json' }); return; }
    if (err?.type === 'entity.too.large') { res.status(413).json({ error: 'Request body too large (max 64 KB)', code: 'payload_too_large' }); return; }
    if (err?.status && err.status >= 400 && err.status < 500) { res.status(err.status).json({ error: err.message || 'Bad request', code: 'bad_request' }); return; }
    logger.error({ err, path: req.path, method: req.method, requestId: (req as any).id }, 'Unhandled Express error');
    res.status(500).json({ error: 'Internal server error', code: 'internal_error', request_id: (req as any).id });
  });

  return app;
}
