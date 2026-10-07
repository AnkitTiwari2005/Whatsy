import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

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

const rawAdminKey = requireEnv('ADMIN_KEY');
if (rawAdminKey.length < 16) {
  throw new Error('ADMIN_KEY must be at least 16 characters for security.');
}
if (rawAdminKey.toLowerCase().includes('change-me')) {
  throw new Error('ADMIN_KEY is set to an insecure placeholder. Please set a secure random string.');
}

const resolvedDataDir = path.resolve(optionalEnv('DATA_DIR', './data'));

/**
 * Dedicated persistent secret for OTP HMAC hashing.
 * Persisted to DATA_DIR/otp.secret so that rotating ADMIN_KEY does not invalidate pending OTPs.
 */
function getOtpSecret(dataDir: string, adminKey: string): string {
  const envSecret = process.env['OTP_SECRET'];
  if (envSecret && envSecret.trim().length >= 16) {
    return envSecret.trim();
  }
  const secretFile = path.join(dataDir, 'otp.secret');
  try {
    if (fs.existsSync(secretFile)) {
      const stored = fs.readFileSync(secretFile, 'utf8').trim();
      if (stored.length >= 32) return stored;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
    return generated;
  } catch {
    // Deterministic fallback derived from adminKey if file creation fails
    return crypto.createHmac('sha256', 'whatsy-otp-salt').update(adminKey).digest('hex');
  }
}

export const config = {
  port: optionalInt('PORT', 3000),
  adminKey: rawAdminKey,
  otpSecret: getOtpSecret(resolvedDataDir, rawAdminKey),

  // Paths — DATA_DIR should point to persistent storage outside deploy dir on Hostinger
  dataDir: resolvedDataDir,
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
