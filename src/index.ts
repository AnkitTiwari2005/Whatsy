// Load env vars first — before any other import reads config
import 'dotenv/config';

import { config } from './config';
import { logger } from './logger';
import { getDb } from './db';
import { createApp } from './app';
import { connectWhatsApp } from './whatsapp/client';

async function main() {
  logger.info('Starting Whatsy...');

  // Initialise database (runs schema if needed)
  getDb();

  // Start WhatsApp connection (non-blocking — reconnect handles failures)
  connectWhatsApp().catch((err) => {
    logger.warn({ err }, 'Initial WhatsApp connection failed — will retry automatically');
  });

  // Start HTTP server
  const app = createApp();
  app.listen(config.port, () => {
    logger.info({ port: config.port }, `Whatsy listening on port ${config.port}`);
    logger.info('Admin UI: http://localhost:' + config.port + '/admin/ui');
    logger.info('Status:   http://localhost:' + config.port + '/api/v1/status');
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});