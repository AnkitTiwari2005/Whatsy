"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Load env vars first — before any other import reads config
require("dotenv/config");
const config_1 = require("./config");
const logger_1 = require("./logger");
const db_1 = require("./db");
const app_1 = require("./app");
const client_1 = require("./whatsapp/client");
async function main() {
    logger_1.logger.info('Starting Whatsy...');
    (0, db_1.getDb)();
    (0, db_1.purgeExpiredOtps)();
    (0, db_1.purgeOldMessages)();
    const housekeeping = setInterval(() => { (0, db_1.purgeExpiredOtps)(); (0, db_1.purgeOldMessages)(); }, 60 * 60 * 1000);
    housekeeping.unref();
    if (config_1.config.nodeEnv === 'production' && config_1.config.trustProxy === false) {
        logger_1.logger.warn('TRUST_PROXY is not set. If this app runs behind a reverse proxy (Hostinger, nginx, Cloudflare), set TRUST_PROXY=1 so rate limits apply per real client instead of per proxy.');
    }
    (0, client_1.startWhatsApp)();
    const server = (0, app_1.createApp)().listen(config_1.config.port, () => {
        logger_1.logger.info({ port: config_1.config.port }, `Whatsy listening on port ${config_1.config.port}`);
        logger_1.logger.info(`Admin UI: http://localhost:${config_1.config.port}/admin/ui/`);
    });
    server.on('error', (err) => { logger_1.logger.fatal({ err }, 'HTTP server error'); process.exit(1); });
    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        logger_1.logger.info({ signal }, 'Shutting down gracefully');
        setTimeout(() => process.exit(1), 12_000).unref(); // hard stop if something hangs
        server.close();
        server.closeIdleConnections?.();
        await (0, client_1.closeWhatsApp)(8000); // let the in-flight message finish
        clearInterval(housekeeping);
        (0, db_1.closeDb)();
        process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
}
process.on('unhandledRejection', (reason) => logger_1.logger.error({ err: reason }, 'Unhandled promise rejection'));
process.on('uncaughtException', (err) => { logger_1.logger.fatal({ err }, 'Uncaught exception — exiting'); process.exit(1); });
main().catch((err) => { console.error('Fatal startup error:', err); process.exit(1); });
//# sourceMappingURL=index.js.map