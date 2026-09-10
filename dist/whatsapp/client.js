"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.toJid = toJid;
exports.getStatus = getStatus;
exports.connectWhatsApp = connectWhatsApp;
exports.requestPairing = requestPairing;
exports.enqueueMessage = enqueueMessage;
exports.getQueueLength = getQueueLength;
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../config");
const logger_1 = require("../logger");
const db_1 = require("../db");
// ── Connection event log ──────────────────────────────────────────────────────
// Appends one line per connection state change to DATA_DIR/connection.log
// Use this file to evaluate stability during a soak test.
function logConnectionEvent(event, detail) {
    const line = `${new Date().toISOString()} | ${event}${detail ? ' | ' + detail : ''}\n`;
    const logPath = path_1.default.join(config_1.config.dataDir, 'connection.log');
    try {
        fs_1.default.appendFileSync(logPath, line);
    }
    catch { /* don't crash the app over logging */ }
}
// ── State ─────────────────────────────────────────────────────────────────────
let sock = null;
let connectionStatus = 'disconnected';
let reconnectAttempts = 0;
let reconnectTimer = null;
let startedAt = new Date();
const messageQueue = [];
let draining = false;
// ── Helpers ───────────────────────────────────────────────────────────────────
/** Convert E.164 number (+919876543210 or 919876543210) to WhatsApp JID */
function toJid(phone) {
    const digits = phone.replace(/\D/g, '');
    return `${digits}@s.whatsapp.net`;
}
function getStatus() {
    return {
        status: connectionStatus,
        uptime_seconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
    };
}
/** Jitter delay between MESSAGE_DELAY_MIN_MS and MESSAGE_DELAY_MAX_MS */
function jitterDelay() {
    const ms = config_1.config.messageDelayMin +
        Math.random() * (config_1.config.messageDelayMax - config_1.config.messageDelayMin);
    return new Promise((r) => setTimeout(r, ms));
}
/** Exponential backoff: 1s -> 2s -> 4s -> ... capped at 300s */
function backoffDelay(attempt) {
    return Math.min(1000 * Math.pow(2, attempt), 300_000);
}
// ── Message queue drain ───────────────────────────────────────────────────────
async function drainQueue() {
    if (draining || connectionStatus !== 'connected')
        return;
    draining = true;
    const db = (0, db_1.getDb)();
    while (messageQueue.length > 0 && connectionStatus === 'connected') {
        const msg = messageQueue.shift();
        try {
            const result = await sock.sendMessage(msg.recipient, { text: msg.body });
            const waId = result?.key?.id ?? null;
            db.prepare(`UPDATE messages SET status='sent', wa_message_id=?, sent_at=datetime('now') WHERE id=?`).run(waId, msg.messageId);
            logger_1.logger.info({ messageId: msg.messageId, recipient: msg.recipient, waId }, 'Message sent');
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            db.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).run(error, msg.messageId);
            logger_1.logger.error({ messageId: msg.messageId, error }, 'Failed to send message');
        }
        if (messageQueue.length > 0) {
            await jitterDelay();
        }
    }
    draining = false;
}
// ── Core connect function ─────────────────────────────────────────────────────
async function connectWhatsApp() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    connectionStatus = 'connecting';
    logger_1.logger.info({ attempt: reconnectAttempts }, 'Connecting to WhatsApp...');
    if (reconnectAttempts === 0) {
        logConnectionEvent('STARTUP', 'server started, initiating first connection');
    }
    fs_1.default.mkdirSync(config_1.config.authStatePath, { recursive: true });
    const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(config_1.config.authStatePath);
    const { version } = await (0, baileys_1.fetchLatestBaileysVersion)();
    logger_1.logger.debug({ version }, 'Baileys version');
    sock = (0, baileys_1.default)({
        version,
        auth: {
            creds: state.creds,
            keys: (0, baileys_1.makeCacheableSignalKeyStore)(state.keys, logger_1.logger),
        },
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        getMessage: async (_key) => ({ conversation: '' }),
    });
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            logger_1.logger.warn('QR code generated — use phone-number pairing via POST /admin/pair instead');
        }
        if (connection === 'open') {
            connectionStatus = 'connected';
            reconnectAttempts = 0;
            logger_1.logger.info('WhatsApp connected');
            logConnectionEvent('CONNECTED', `reconnect_attempts_needed=${reconnectAttempts}`);
            setImmediate(() => drainQueue());
            return;
        }
        if (connection === 'connecting') {
            connectionStatus = 'connecting';
            return;
        }
        if (connection === 'close') {
            connectionStatus = 'disconnected';
            const err = lastDisconnect?.error;
            const code = err?.output?.statusCode;
            logger_1.logger.warn({ code }, 'WhatsApp connection closed');
            // 401 = loggedOut — wipe session and do NOT auto-reconnect
            if (code === baileys_1.DisconnectReason.loggedOut) {
                logger_1.logger.error('WhatsApp logged out (401). Session cleared. Call POST /admin/pair to re-authenticate.');
                logConnectionEvent('LOGGED_OUT', 'code=401 session cleared — re-pairing required');
                try {
                    fs_1.default.rmSync(config_1.config.authStatePath, { recursive: true, force: true });
                    fs_1.default.mkdirSync(config_1.config.authStatePath, { recursive: true });
                }
                catch { /* ignore */ }
                sock = null;
                return;
            }
            // 515 = restartRequired — reconnect immediately
            const delay = code === baileys_1.DisconnectReason.restartRequired
                ? 0
                : backoffDelay(reconnectAttempts++);
            logConnectionEvent('DISCONNECTED', `code=${code} reconnect_in=${delay}ms attempt=${reconnectAttempts}`);
            logger_1.logger.info({ delayMs: delay, attempt: reconnectAttempts }, 'Scheduling reconnect');
            reconnectTimer = setTimeout(connectWhatsApp, delay);
        }
    });
    sock.ev.on('creds.update', saveCreds);
}
// ── Pairing code ──────────────────────────────────────────────────────────────
async function requestPairing(phoneNumber) {
    if (!sock) {
        await connectWhatsApp();
        await new Promise((r) => setTimeout(r, 1500));
    }
    if (!sock)
        throw new Error('Failed to initialise WhatsApp socket');
    if (sock.authState.creds.registered) {
        throw new Error('WhatsApp is already paired. Revoke the session first via the auth_state directory.');
    }
    const digits = phoneNumber.replace(/\D/g, '');
    logger_1.logger.info({ phone: digits }, 'Requesting pairing code');
    const code = await sock.requestPairingCode(digits);
    return code;
}
// ── Queue ─────────────────────────────────────────────────────────────────────
function enqueueMessage(msg) {
    if (messageQueue.length >= config_1.config.maxQueueSize) {
        throw new Error(`Message queue full (limit: ${config_1.config.maxQueueSize}). WhatsApp may be disconnected.`);
    }
    messageQueue.push(msg);
    logger_1.logger.debug({ messageId: msg.messageId, queueLength: messageQueue.length }, 'Message enqueued');
    if (connectionStatus === 'connected') {
        setImmediate(() => drainQueue());
    }
}
function getQueueLength() {
    return messageQueue.length;
}
//# sourceMappingURL=client.js.map