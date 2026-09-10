import Database from 'better-sqlite3';
export declare function getDb(): Database.Database;
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
//# sourceMappingURL=index.d.ts.map