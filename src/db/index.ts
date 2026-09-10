import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../logger';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure data directory exists
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  _db = new Database(config.dbPath);

  // Enable WAL mode and foreign keys — WAL allows concurrent reads while writing
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');

  // Run schema (idempotent — all statements use IF NOT EXISTS)
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  _db.exec(schema);

  logger.info({ path: config.dbPath }, 'Database ready');
  return _db;
}

// ── Typed row shapes ──────────────────────────────────────────────────────────

export interface ProjectRow {
  id: number;
  name: string;
  description: string | null;
  default_recipient: string | null;
  active: number;
  created_at: string;
}

export interface ApiKeyRow {
  id: number;
  project_id: number;
  key_hash: string;
  key_prefix: string;
  label: string | null;
  active: number;
  created_at: string;
  last_used_at: string | null;
}

export interface MessageRow {
  id: number;
  project_id: number;
  recipient: string;
  body: string;
  status: 'queued' | 'sent' | 'failed';
  error: string | null;
  wa_message_id: string | null;
  sent_at: string | null;
  created_at: string;
}
