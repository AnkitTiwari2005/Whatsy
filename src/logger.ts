import pino from 'pino';
import { config } from './config';

// pino-pretty is a dev convenience only; production logs stay structured JSON.
export const logger = pino({
  level: config.logLevel,
  redact: { paths: ['req.headers["x-api-key"]', 'req.headers["x-admin-key"]'], censor: '[hidden]' },
  transport: config.nodeEnv !== 'production' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});
