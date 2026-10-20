import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb, ProjectRow, ApiKeyRow } from '../../db';
import { logger } from '../../logger';
import { HttpError, isoUtc } from '../../util/http';
import { normalizePhone } from '../../util/phone';
import { hashApiKey } from '../middleware/auth';

export const projectsRouter = Router();

function cleanName(v: unknown): string {
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_name', 'name is required');
  const n = v.trim().replace(/\s+/g, ' ');
  if (n.length < 1 || n.length > 64) throw new HttpError(400, 'invalid_name', 'name must be 1–64 characters');
  if (/[\u0000-\u001f<>]/.test(n)) throw new HttpError(400, 'invalid_name', 'name contains invalid characters');
  return n;
}
function cleanDescription(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || v.trim().length > 280) throw new HttpError(400, 'invalid_description', 'description must be text of at most 280 characters');
  return v.trim();
}
function cleanRecipient(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const p = normalizePhone(v);
  if (!p.ok) throw new HttpError(400, 'invalid_recipient', `default_recipient ${p.error}`);
  return p.e164;
}
function cleanLabel(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || v.trim().length > 64) throw new HttpError(400, 'invalid_label', 'label must be at most 64 characters');
  return v.trim();
}
function nameTaken(name: string, exceptId?: number): boolean {
  return !!getDb().prepare('SELECT id FROM projects WHERE lower(trim(name)) = lower(?) AND id != ?').get(name, exceptId ?? -1);
}
function newKey() {
  const rawKey = crypto.randomBytes(32).toString('base64url');
  return { rawKey, prefix: rawKey.slice(0, 8), hash: hashApiKey(rawKey) };
}
const projectView = (p: ProjectRow, keys: Array<Omit<ApiKeyRow, 'key_hash' | 'project_id'>>) => ({
  ...p, created_at: isoUtc(p.created_at), active: p.active,
  api_keys: keys.map((k) => ({ ...k, created_at: isoUtc(k.created_at), last_used_at: isoUtc(k.last_used_at) })),
});

projectsRouter.get('/', (_req: Request, res: Response): void => {
  const db = getDb();
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC, id DESC').all() as ProjectRow[];
  const keyStmt = db.prepare(`SELECT id, key_prefix, label, active, created_at, last_used_at FROM api_keys WHERE project_id = ? ORDER BY created_at DESC, id DESC`);
  res.json(projects.map((p) => projectView(p, keyStmt.all(p.id) as any)));
});

projectsRouter.post('/', (req: Request, res: Response): void => {
  const name = cleanName(req.body.name);
  const description = cleanDescription(req.body.description);
  const recipient = cleanRecipient(req.body.default_recipient);
  if (nameTaken(name)) throw new HttpError(409, 'name_taken', `A project named "${name}" already exists`);
  const db = getDb();
  const { rawKey, prefix, hash } = newKey();
  try {
    const projectId = db.transaction(() => {
      const id = db.prepare('INSERT INTO projects (name, description, default_recipient) VALUES (?, ?, ?)').run(name, description, recipient).lastInsertRowid as number;
      db.prepare(`INSERT INTO api_keys (project_id, key_hash, key_prefix, label) VALUES (?, ?, ?, 'default')`).run(id, hash, prefix);
      return id;
    })();
    logger.info({ projectId, name }, 'Project created');
    res.status(201).json({ id: projectId, name, description, default_recipient: recipient, api_key: rawKey, api_key_prefix: prefix, note: 'Save this API key — it will not be shown again.' });
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) throw new HttpError(409, 'name_taken', `A project named "${name}" already exists`);
    throw err;
  }
});

projectsRouter.patch('/:id', (req: Request, res: Response): void => {
  const db = getDb();
  const id = Number(req.params.id);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  if (!project) throw new HttpError(404, 'not_found', 'Project not found');

  const b = req.body as Record<string, unknown>;
  const sets: string[] = []; const vals: Array<string | number | null> = [];
  if ('name' in b) { const n = cleanName(b.name); if (nameTaken(n, id)) throw new HttpError(409, 'name_taken', `A project named "${n}" already exists`); sets.push('name = ?'); vals.push(n); }
  if ('description' in b) { sets.push('description = ?'); vals.push(cleanDescription(b.description)); }
  if ('default_recipient' in b) { sets.push('default_recipient = ?'); vals.push(cleanRecipient(b.default_recipient)); }
  if ('active' in b) { if (typeof b.active !== 'boolean') throw new HttpError(400, 'invalid_active', 'active must be true or false'); sets.push('active = ?'); vals.push(b.active ? 1 : 0); }
  if (sets.length === 0) throw new HttpError(400, 'nothing_to_update', 'Provide at least one of: name, description, default_recipient, active');
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  res.json({ ok: true });
});

projectsRouter.post('/:id/keys', (req: Request, res: Response): void => {
  const db = getDb();
  const project = db.prepare('SELECT id, active FROM projects WHERE id = ?').get(Number(req.params.id)) as { id: number; active: number } | undefined;
  if (!project) throw new HttpError(404, 'not_found', 'Project not found');
  if (!project.active) throw new HttpError(409, 'project_inactive', 'Project is deactivated — activate it before creating keys');
  const label = cleanLabel(req.body.label);
  const { rawKey, prefix, hash } = newKey();
  db.prepare('INSERT INTO api_keys (project_id, key_hash, key_prefix, label) VALUES (?, ?, ?, ?)').run(project.id, hash, prefix, label);
  logger.info({ projectId: project.id, prefix }, 'API key created');
  res.status(201).json({ api_key: rawKey, api_key_prefix: prefix, label, note: 'Save this API key — it will not be shown again.' });
});

projectsRouter.delete('/:id/keys/:keyId', (req: Request, res: Response): void => {
  const r = getDb().prepare('UPDATE api_keys SET active = 0 WHERE id = ? AND project_id = ? AND active = 1').run(Number(req.params.keyId), Number(req.params.id));
  if (r.changes === 0) throw new HttpError(404, 'not_found', 'Key not found or already revoked');
  logger.info({ projectId: req.params.id, keyId: req.params.keyId }, 'API key revoked');
  res.json({ ok: true, message: 'Key revoked. Requests using this key are rejected immediately.' });
});
