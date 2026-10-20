"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.closeDb = closeDb;
exports.dbHealthy = dbHealthy;
exports.purgeExpiredOtps = purgeExpiredOtps;
exports.purgeOldMessages = purgeOldMessages;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../config");
const logger_1 = require("../logger");
let _db = null;
function getDb() {
    if (_db)
        return _db;
    fs_1.default.mkdirSync(path_1.default.dirname(config_1.config.dbPath), { recursive: true });
    const db = new better_sqlite3_1.default(config_1.config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.exec(fs_1.default.readFileSync(path_1.default.join(__dirname, 'schema.sql'), 'utf-8'));
    migrate(db);
    _db = db;
    logger_1.logger.info({ path: config_1.config.dbPath }, 'Database ready');
    return db;
}
function closeDb() {
    try {
        _db?.close();
    }
    catch (err) {
        logger_1.logger.warn({ err }, 'Error closing database');
    }
    _db = null;
}
/** Cheap liveness probe used by /health. */
function dbHealthy() {
    try {
        getDb().prepare('SELECT 1').get();
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Versioned, idempotent migrations (PRAGMA user_version). Each step is safe to re-run on an existing database.
 *  v1: idempotency keys, status index (queue recovery), case-insensitive unique project names.
 */
function migrate(db) {
    const row = db.prepare('PRAGMA user_version').get();
    const version = row?.user_version ?? 0;
    if (version < 1) {
        const cols = db.prepare('PRAGMA table_info(messages)').all();
        if (!cols.some((c) => c.name === 'idempotency_key'))
            db.exec('ALTER TABLE messages ADD COLUMN idempotency_key TEXT');
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idem ON messages(project_id, idempotency_key) WHERE idempotency_key IS NOT NULL`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_status_id ON messages(status, id)`);
        try {
            db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name_ci ON projects(lower(trim(name)))`);
        }
        catch (err) {
            logger_1.logger.warn({ err }, 'Existing projects differ only by case/whitespace; case-insensitive uniqueness not enforced at DB level (API still checks)');
        }
        db.exec('PRAGMA user_version = 1');
        logger_1.logger.info('Database migrated to v1');
    }
}
/** Housekeeping: drop OTP rows that expired more than 24h ago. Uses julianday() so ISO ('T…Z') and SQLite formats compare correctly. */
function purgeExpiredOtps() {
    try {
        const r = getDb().prepare(`DELETE FROM otps WHERE julianday(expires_at) < julianday('now', '-24 hours')`).run();
        if (r.changes > 0)
            logger_1.logger.info({ purgedCount: r.changes }, 'Purged expired OTP records');
        return r.changes;
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Failed to purge expired OTP records');
        return 0;
    }
}
/** Optional retention (MESSAGE_RETENTION_DAYS > 0): delete finished messages older than N days. */
function purgeOldMessages() {
    if (config_1.config.messageRetentionDays <= 0)
        return 0;
    try {
        const r = getDb().prepare(`DELETE FROM messages WHERE status IN ('sent','failed') AND julianday(created_at) < julianday('now', ?)`).run(`-${config_1.config.messageRetentionDays} days`);
        if (r.changes > 0)
            logger_1.logger.info({ purgedCount: r.changes }, 'Purged messages past retention');
        return r.changes;
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Failed to purge old messages');
        return 0;
    }
}
//# sourceMappingURL=index.js.map