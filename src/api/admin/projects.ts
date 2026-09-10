import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb, ProjectRow, ApiKeyRow } from '../../db';
import { logger } from '../../logger';

export const projectsRouter = Router();

// List all projects
projectsRouter.get('/', (_req: Request, res: Response): void => {
  const db = getDb();
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as ProjectRow[];

  const result = projects.map((p) => {
    const keys = db
      .prepare(
        `SELECT id, key_prefix, label, active, created_at, last_used_at
         FROM api_keys WHERE project_id = ? ORDER BY created_at DESC`
      )
      .all(p.id) as Omit<ApiKeyRow, 'key_hash' | 'project_id'>[];
    return { ...p, api_keys: keys };
  });

  res.json(result);
});

// Create project
projectsRouter.post('/', (req: Request, res: Response): void => {
  const { name, description, default_recipient } = req.body as {
    name?: string;
    description?: string;
    default_recipient?: string;
  };

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const db = getDb();

  try {
    const projectResult = db
      .prepare(
        `INSERT INTO projects (name, description, default_recipient) VALUES (?, ?, ?)`
      )
      .run(name.trim(), description ?? null, default_recipient ?? null);

    const projectId = projectResult.lastInsertRowid as number;
    const { rawKey, prefix, hash } = generateApiKey();

    db.prepare(
      `INSERT INTO api_keys (project_id, key_hash, key_prefix, label) VALUES (?, ?, ?, 'default')`
    ).run(projectId, hash, prefix);

    logger.info({ projectId, name: name.trim() }, 'Project created');

    res.status(201).json({
      id: projectId,
      name: name.trim(),
      description: description ?? null,
      default_recipient: default_recipient ?? null,
      api_key: rawKey,
      api_key_prefix: prefix,
      note: 'Save this API key — it will not be shown again.',
    });
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE constraint')) {
      res.status(409).json({ error: `Project with name "${name}" already exists` });
      return;
    }
    throw err;
  }
});

// Update project
projectsRouter.patch('/:id', (req: Request, res: Response): void => {
  const { id } = req.params;
  const { description, default_recipient, active } = req.body as {
    description?: string;
    default_recipient?: string;
    active?: boolean;
  };

  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  db.prepare(
    `UPDATE projects SET
       description = COALESCE(?, description),
       default_recipient = COALESCE(?, default_recipient),
       active = COALESCE(?, active)
     WHERE id = ?`
  ).run(
    description ?? null,
    default_recipient ?? null,
    active !== undefined ? (active ? 1 : 0) : null,
    id
  );

  res.json({ ok: true });
});

// Add API key
projectsRouter.post('/:id/keys', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { label } = req.body as { label?: string };

  const db = getDb();
  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND active = 1').get(id) as { id: number } | undefined;

  if (!project) {
    res.status(404).json({ error: 'Project not found or inactive' });
    return;
  }

  const { rawKey, prefix, hash } = generateApiKey();

  db.prepare(
    `INSERT INTO api_keys (project_id, key_hash, key_prefix, label) VALUES (?, ?, ?, ?)`
  ).run(project.id, hash, prefix, label ?? null);

  logger.info({ projectId: project.id, prefix }, 'API key created');

  res.status(201).json({
    api_key: rawKey,
    api_key_prefix: prefix,
    label: label ?? null,
    note: 'Save this API key — it will not be shown again.',
  });
});

// Revoke API key
projectsRouter.delete('/:id/keys/:keyId', (req: Request, res: Response): void => {
  const { id, keyId } = req.params;
  const db = getDb();

  const result = db
    .prepare(
      `UPDATE api_keys SET active = 0 WHERE id = ? AND project_id = ? AND active = 1`
    )
    .run(keyId, id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Key not found or already revoked' });
    return;
  }

  logger.info({ projectId: id, keyId }, 'API key revoked');
  res.json({ ok: true, message: 'Key revoked. Existing requests using this key will be rejected immediately.' });
});

// Generate a 32-byte random API key
function generateApiKey(): { rawKey: string; prefix: string; hash: string } {
  const rawKey = crypto.randomBytes(32).toString('base64url');
  const prefix = rawKey.slice(0, 8);
  const hash = bcrypt.hashSync(rawKey, 10);
  return { rawKey, prefix, hash };
}