"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const path_1 = __importDefault(require("path"));
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
exports.config = {
    port: optionalInt('PORT', 3000),
    adminKey: requireEnv('ADMIN_KEY'),
    // Paths — DATA_DIR should point to persistent storage outside deploy dir on Hostinger
    dataDir: path_1.default.resolve(optionalEnv('DATA_DIR', './data')),
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