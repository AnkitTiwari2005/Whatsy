import path from 'path';

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function optionalBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return fallback;
  return val.toLowerCase() === 'true';
}

function optionalInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed)) throw new Error(`Environment variable ${key} must be an integer`);
  return parsed;
}

export const config = {
  port: optionalInt('PORT', 3000),
  adminKey: requireEnv('ADMIN_KEY'),

  // Paths — DATA_DIR should point to persistent storage outside deploy dir on Hostinger
  dataDir: path.resolve(optionalEnv('DATA_DIR', './data')),
  get dbPath() { return path.join(this.dataDir, 'whatsy.db'); },
  get authStatePath() { return path.join(this.dataDir, 'auth_state'); },

  // WhatsApp
  waPhoneNumber: optionalEnv('WA_PHONE_NUMBER', ''),

  // Message queue jitter
  messageDelayMin: optionalInt('MESSAGE_DELAY_MIN_MS', 2000),
  messageDelayMax: optionalInt('MESSAGE_DELAY_MAX_MS', 5000),
  maxQueueSize: optionalInt('MAX_QUEUE_SIZE', 100),

  // Logging
  redactBodies: optionalBool('REDACT_BODIES', false),
  logLevel: optionalEnv('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
} as const;
