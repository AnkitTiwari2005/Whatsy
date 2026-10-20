// Load env vars first — before any other import reads config
import 'dotenv/config';

import { config } from './config';
import { logger } from './logger';
import { getDb, closeDb, purgeExpiredOtps, purgeOldMessages } from './db';
import { createApp } from './app';
import { startWhatsApp, closeWhatsApp } from './whatsapp/client';

async function main() {
  logger.info('Starting Whatsy...');
  getDb();
  purgeExpiredOtps(); purgeOldMessages();
  const housekeeping = setInterval(() => { purgeExpiredOtps(); purgeOldMessages(); }, 60 * 60 * 1000);
  housekeeping.unref();

  if (config.nodeEnv === 'production' && config.trustProxy === false) {
    logger.warn('TRUST_PROXY is not set. If this app runs behind a reverse proxy (Hostinger, nginx, Cloudflare), set TRUST_PROXY=1 so rate limits apply per real client instead of per proxy.');
  }

  startWhatsApp();

  const server = createApp().listen(config.port, () => {
    logger.info({ port: config.port }, `Whatsy listening on port ${config.port}`);
    logger.info(`Admin UI: http://localhost:${config.port}/admin/ui/`);
  });
  server.on('error', (err) => { logger.fatal({ err }, 'HTTP server error'); process.exit(1); });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');
    setTimeout(() => process.exit(1), 12_000).unref();   // hard stop if something hangs
    server.close();
    (server as any).closeIdleConnections?.();
    await closeWhatsApp(8000);                           // let the in-flight message finish
    clearInterval(housekeeping);
    closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'Unhandled promise rejection'));
process.on('uncaughtException', (err) => { logger.fatal({ err }, 'Uncaught exception — exiting'); process.exit(1); });

main().catch((err) => { console.error('Fatal startup error:', err); process.exit(1); });
