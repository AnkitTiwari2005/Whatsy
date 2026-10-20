import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../logger';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8'));
  migrate(db);
  _db = db;
  logger.info({ path: config.dbPath }, 'Database ready');
  return db;
}

export function closeDb(): void {
  try { _db?.close(); } catch (err) { logger.warn({ err }, 'Error closing database'); }
  _db = null;
}

/** Cheap liveness probe used by /health. */
export function dbHealthy(): boolean {
  try { getDb().prepare('SELECT 1').get(); return true; } catch { return false; }
}

/**
 * Versioned, idempotent migrations (PRAGMA user_version). Each step is safe to re-run on an existing database.
 *  v1: idempotency keys, status index (queue recovery), case-insensitive unique project names.
 */
function migrate(db: Database.Database): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  const version = row?.user_version ?? 0;
  if (version < 1) {
    const cols = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'idempotency_key')) db.exec('ALTER TABLE messages ADD COLUMN idempotency_key TEXT');
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idem ON messages(project_id, idempotency_key) WHERE idempotency_key IS NOT NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_status_id ON messages(status, id)`);
    try {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name_ci ON projects(lower(trim(name)))`);
    } catch (err) {
      logger.warn({ err }, 'Existing projects differ only by case/whitespace; case-insensitive uniqueness not enforced at DB level (API still checks)');
    }
    db.exec('PRAGMA user_version = 1');
    logger.info('Database migrated to v1');
  }
}

/** Housekeeping: drop OTP rows that expired more than 24h ago. Uses julianday() so ISO ('T…Z') and SQLite formats compare correctly. */
export function purgeExpiredOtps(): number {
  try {
    const r = getDb().prepare(`DELETE FROM otps WHERE julianday(expires_at) < julianday('now', '-24 hours')`).run();
    if (r.changes > 0) logger.info({ purgedCount: r.changes }, 'Purged expired OTP records');
    return r.changes;
  } catch (err) {
    logger.error({ err }, 'Failed to purge expired OTP records');
    return 0;
  }
}

/** Optional retention (MESSAGE_RETENTION_DAYS > 0): delete finished messages older than N days. */
export function purgeOldMessages(): number {
  if (config.messageRetentionDays <= 0) return 0;
  try {
    const r = getDb().prepare(
      `DELETE FROM messages WHERE status IN ('sent','failed') AND julianday(created_at) < julianday('now', ?)`
    ).run(`-${config.messageRetentionDays} days`);
    if (r.changes > 0) logger.info({ purgedCount: r.changes }, 'Purged messages past retention');
    return r.changes;
  } catch (err) {
    logger.error({ err }, 'Failed to purge old messages');
    return 0;
  }
}

// ── Typed row shapes ──────────────────────────────────────────────────────────
export interface ProjectRow { id: number; name: string; description: string | null; default_recipient: string | null; active: number; created_at: string; }
export interface ApiKeyRow { id: number; project_id: number; key_hash: string; key_prefix: string; label: string | null; active: number; created_at: string; last_used_at: string | null; }
export interface MessageRow { id: number; project_id: number; recipient: string; body: string; status: 'queued' | 'sent' | 'failed'; error: string | null; wa_message_id: string | null; sent_at: string | null; created_at: string; idempotency_key?: string | null; }
export interface OtpRow { id: number; project_id: number; phone: string; code_hash: string; attempts_left: number; verified: number; expires_at: string; created_at: string; }
