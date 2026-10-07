"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
function requireEnv(key) {
    const val = process.env[key];
    if (!val)
        throw new Error(`Missing required environment variable: ${key}`);
    return val;
}
function optionalEnv(key, fallback) {
    return process.env[key] || fallback;
}
function optionalBool(key, fallback) {
    const val = process.env[key];
    if (val === undefined)
        return fallback;
    return val.toLowerCase() === 'true';
}
function optionalInt(key, fallback) {
    const val = process.env[key];
    if (!val)
        return fallback;
    const parsed = parseInt(val, 10);
    if (isNaN(parsed))
        throw new Error(`Environment variable ${key} must be an integer`);
    return parsed;
}
const rawAdminKey = requireEnv('ADMIN_KEY');
if (rawAdminKey.length < 16) {
    throw new Error('ADMIN_KEY must be at least 16 characters for security.');
}
if (rawAdminKey.toLowerCase().includes('change-me')) {
    throw new Error('ADMIN_KEY is set to an insecure placeholder. Please set a secure random string.');
}
const resolvedDataDir = path_1.default.resolve(optionalEnv('DATA_DIR', './data'));
/**
 * Dedicated persistent secret for OTP HMAC hashing.
 * Persisted to DATA_DIR/otp.secret so that rotating ADMIN_KEY does not invalidate pending OTPs.
 */
function getOtpSecret(dataDir, adminKey) {
    const envSecret = process.env['OTP_SECRET'];
    if (envSecret && envSecret.trim().length >= 16) {
        return envSecret.trim();
    }
    const secretFile = path_1.default.join(dataDir, 'otp.secret');
    try {
        if (fs_1.default.existsSync(secretFile)) {
            const stored = fs_1.default.readFileSync(secretFile, 'utf8').trim();
            if (stored.length >= 32)
                return stored;
        }
        const generated = crypto_1.default.randomBytes(32).toString('hex');
        fs_1.default.mkdirSync(dataDir, { recursive: true });
        fs_1.default.writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
        return generated;
    }
    catch {
        // Deterministic fallback derived from adminKey if file creation fails
        return crypto_1.default.createHmac('sha256', 'whatsy-otp-salt').update(adminKey).digest('hex');
    }
}
exports.config = {
    port: optionalInt('PORT', 3000),
    adminKey: rawAdminKey,
    otpSecret: getOtpSecret(resolvedDataDir, rawAdminKey),
    // Paths — DATA_DIR should point to persistent storage outside deploy dir on Hostinger
    dataDir: resolvedDataDir,
    get dbPath() { return path_1.default.join(this.dataDir, 'whatsy.db'); },
    get authStatePath() { return path_1.default.join(this.dataDir, 'auth_state'); },
    // WhatsApp
    waPhoneNumber: optionalEnv('WA_PHONE_NUMBER', ''),
    // Message queue jitter
    messageDelayMin: optionalInt('MESSAGE_DELAY_MIN_MS', 2000),
    messageDelayMax: optionalInt('MESSAGE_DELAY_MAX_MS', 5000),
    maxQueueSize: optionalInt('MAX_QUEUE_SIZE', 100),
    // Logging
    redactBodies: optionalBool('REDACT_BODIES', false),
    logLevel: optionalEnv('LOG_LEVEL', 'info'),
};
//# sourceMappingURL=config.js.map