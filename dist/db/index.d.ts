import Database from 'better-sqlite3';
export declare function getDb(): Database.Database;
export declare function closeDb(): void;
/** Cheap liveness probe used by /health. */
export declare function dbHealthy(): boolean;
/** Housekeeping: drop OTP rows that expired more than 24h ago. Uses julianday() so ISO ('T…Z') and SQLite formats compare correctly. */
export declare function purgeExpiredOtps(): number;
/** Optional retention (MESSAGE_RETENTION_DAYS > 0): delete finished messages older than N days. */
export declare function purgeOldMessages(): number;
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
    idempotency_key?: string | null;
}
export interface OtpRow {
    id: number;
    project_id: number;
    phone: string;
    code_hash: string;
    attempts_left: number;
    verified: number;
    expires_at: string;
    created_at: string;
}
//# sourceMappingURL=index.d.ts.map