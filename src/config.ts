import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}
function optionalEnv(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}
function optionalBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (val === undefined || val === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(val.toLowerCase());
}
/** Integer env var with bounds — a bad value fails fast at boot with a clear message. */
function optionalInt(key: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Environment variable ${key} must be an integer between ${min} and ${max} (got "${raw}")`);
  }
  return parsed;
}

const rawAdminKey = requireEnv('ADMIN_KEY');
if (rawAdminKey.length < 16) throw new Error('ADMIN_KEY must be at least 16 characters for security.');
if (rawAdminKey.toLowerCase().includes('change-me')) {
  throw new Error('ADMIN_KEY is set to an insecure placeholder. Please set a secure random string.');
}

const resolvedDataDir = path.resolve(optionalEnv('DATA_DIR', './data'));

/**
 * Persistent secret for OTP HMAC hashing (OTP_SECRET env, else DATA_DIR/otp.secret).
 * If neither can be read or written we refuse to start rather than silently deriving a weaker key.
 */
function getOtpSecret(dataDir: string): string {
  const envSecret = process.env['OTP_SECRET']?.trim();
  if (envSecret && envSecret.length >= 16) return envSecret;
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
  } catch (err) {
    throw new Error(
      `Cannot read/write ${secretFile} (${(err as Error).message}). Set OTP_SECRET (16+ chars) or fix DATA_DIR permissions.`
    );
  }
}

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
const logLevel = optionalEnv('LOG_LEVEL', 'info');
if (!(logLevels as readonly string[]).includes(logLevel)) {
  throw new Error(`LOG_LEVEL must be one of ${logLevels.join(', ')} (got "${logLevel}")`);
}

const delayMin = optionalInt('MESSAGE_DELAY_MIN_MS', 2000, 0, 60_000);
const delayMax = optionalInt('MESSAGE_DELAY_MAX_MS', 5000, 0, 120_000);
if (delayMin > delayMax) throw new Error('MESSAGE_DELAY_MIN_MS must be <= MESSAGE_DELAY_MAX_MS');

/** TRUST_PROXY: "false" (default), "true", or the number of reverse-proxy hops in front of the app (e.g. 1). */
function parseTrustProxy(): boolean | number {
  const v = optionalEnv('TRUST_PROXY', 'false').toLowerCase();
  if (v === 'false' || v === '0') return false;
  if (v === 'true') return true;
  const n = Number(v);
  if (Number.isInteger(n) && n > 0 && n < 10) return n;
  throw new Error('TRUST_PROXY must be "false", "true" or a hop count between 1 and 9');
}

export const config = {
  port: optionalInt('PORT', 3000, 1, 65535),
  adminKey: rawAdminKey,
  otpSecret: getOtpSecret(resolvedDataDir),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),

  dataDir: resolvedDataDir,
  get dbPath() { return path.join(this.dataDir, 'whatsy.db'); },
  get authStatePath() { return path.join(this.dataDir, 'auth_state'); },

  waPhoneNumber: optionalEnv('WA_PHONE_NUMBER', ''),
  /** Digits only, e.g. 91. When set, 10-digit / 0-prefixed national numbers are normalised to E.164. Defaults to 91 (India). */
  defaultCountryCode: optionalEnv('DEFAULT_COUNTRY_CODE', '91').replace(/\D/g, '') || '91',

  // Queue
  messageDelayMin: delayMin,
  messageDelayMax: delayMax,
  maxQueueSize: optionalInt('MAX_QUEUE_SIZE', 100, 1, 10_000),
  sendTimeoutMs: optionalInt('SEND_TIMEOUT_MS', 20_000, 1000, 120_000),
  sendMaxAttempts: optionalInt('SEND_MAX_ATTEMPTS', 3, 1, 10),
  maxMessageLength: optionalInt('MAX_MESSAGE_LENGTH', 4096, 1, 65_000),

  // OTP policy
  otpCooldownSeconds: optionalInt('OTP_COOLDOWN_SECONDS', 60, 0, 3600),
  otpMaxPerHour: optionalInt('OTP_MAX_PER_HOUR', 5, 1, 100),

  // HTTP hardening
  trustProxy: parseTrustProxy(),
  corsOrigins: optionalEnv('CORS_ORIGINS', '').split(',').map((s) => s.trim()).filter(Boolean),
  ipRatePerMin: optionalInt('RATE_LIMIT_IP_PER_MIN', 300, 10, 100_000),
  messagesRatePerMin: optionalInt('RATE_LIMIT_MESSAGES_PER_MIN', 60, 1, 100_000),
  otpRatePerMin: optionalInt('RATE_LIMIT_OTP_PER_MIN', 30, 1, 100_000),
  adminFailMax: optionalInt('ADMIN_FAIL_MAX', 10, 1, 1000),
  adminFailWindowSec: optionalInt('ADMIN_FAIL_WINDOW_SEC', 900, 10, 86_400),

  // Data retention (0 = keep forever)
  messageRetentionDays: optionalInt('MESSAGE_RETENTION_DAYS', 0, 0, 3650),

  redactBodies: optionalBool('REDACT_BODIES', false),
  logLevel: logLevel as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',
} as const;

export const REDACTED_BODY = '[redacted]';
