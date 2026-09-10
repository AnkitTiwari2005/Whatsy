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
    // Initialise database (runs schema if needed)
    (0, db_1.getDb)();
    // Start WhatsApp connection (non-blocking — reconnect handles failures)
    (0, client_1.connectWhatsApp)().catch((err) => {
        logger_1.logger.warn({ err }, 'Initial WhatsApp connection failed — will retry automatically');
    });
    // Start HTTP server
    const app = (0, app_1.createApp)();
    app.listen(config_1.config.port, () => {
        logger_1.logger.info({ port: config_1.config.port }, `Whatsy listening on port ${config_1.config.port}`);
        logger_1.logger.info('Admin UI: http://localhost:' + config_1.config.port + '/admin/ui');
        logger_1.logger.info('Status:   http://localhost:' + config_1.config.port + '/api/v1/status');
    });
}
main().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map