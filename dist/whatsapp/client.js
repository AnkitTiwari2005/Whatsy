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
exports.normalizePhone = void 0;
exports.toJid = toJid;
exports.isWhatsAppReady = isWhatsAppReady;
exports.getStatus = getStatus;
exports.getQueueLength = getQueueLength;
exports.sendDirectMessage = sendDirectMessage;
exports.loadPendingMessagesFromDb = loadPendingMessagesFromDb;
exports.connectWhatsApp = connectWhatsApp;
exports.startWhatsApp = startWhatsApp;
exports.requestPairing = requestPairing;
exports.unlinkSession = unlinkSession;
exports.enqueueMessage = enqueueMessage;
exports.closeWhatsApp = closeWhatsApp;
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../config");
const logger_1 = require("../logger");
const db_1 = require("../db");
const http_1 = require("../util/http");
const phone_1 = require("../util/phone");
function logConnectionEvent(event, detail) {
    const line = `${new Date().toISOString()} | ${event}${detail ? ' | ' + detail : ''}\n`;
    const file = path_1.default.join(config_1.config.dataDir, 'connection.log');
    try {
        try {
            if (fs_1.default.statSync(file).size > 1_000_000)
                fs_1.default.renameSync(file, file + '.1');
        }
        catch { /* no file yet */ } // keep the log bounded
        fs_1.default.appendFileSync(file, line);
    }
    catch { /* never crash over logging */ }
}
// ── State ─────────────────────────────────────────────────────────────────────
let sock = null;
let connectionStatus = 'disconnected';
let reconnectAttempts = 0;
let reconnectTimer = null;
let connecting = null;
let stopped = false;
let draining = false;
let lastConnectedAt = null;
let lastDisconnectCode;
let pairingIssuedAt = null;
let qrSeen = false; // true once the current socket finished its handshake (safe to request a pairing code)
let reconcileTimer = null;
let credsCache = null;
const startedAt = new Date();
const messageQueue = [];
const inFlight = new Set(); // rows currently being sent (still 'queued' in the DB)
const sentCache = new Map(); // recent outbound content, needed so WhatsApp retry requests re-send the REAL message
const SENT_CACHE_MAX = 500;
// ── Helpers ───────────────────────────────────────────────────────────────────
var phone_2 = require("../util/phone");
Object.defineProperty(exports, "normalizePhone", { enumerable: true, get: function () { return phone_2.normalizePhone; } });
function toJid(phone) {
    const norm = (0, phone_1.normalizePhone)(phone);
    const digits = norm.ok ? norm.digits : phone.replace(/\D/g, '');
    return `${digits}@s.whatsapp.net`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isWhatsAppReady() {
    return connectionStatus === 'connected' && sock !== null && Boolean(sock.user || sock.authState?.creds?.me);
}
/** creds.json exists even for a half-finished pairing, so read its real `registered` flag (cached by mtime). */
function registeredOnDisk() {
    try {
        const f = path_1.default.join(config_1.config.authStatePath, 'creds.json');
        const m = fs_1.default.statSync(f).mtimeMs;
        if (credsCache && credsCache.mtime === m)
            return credsCache.registered;
        const registered = JSON.parse(fs_1.default.readFileSync(f, 'utf8')).registered === true;
        credsCache = { mtime: m, registered };
        return registered;
    }
    catch {
        return false;
    }
}
function getStatus() {
    const registered = sock ? Boolean(sock.authState?.creds?.registered) : registeredOnDisk();
    return {
        status: connectionStatus,
        uptime_seconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
        is_ready: isWhatsAppReady(),
        registered,
        last_connected_at: lastConnectedAt ? lastConnectedAt.toISOString() : null,
        last_disconnect_code: lastDisconnectCode ?? null,
        pairing_issued_at: pairingIssuedAt ? pairingIssuedAt.toISOString() : null,
    };
}
function getQueueLength() { return messageQueue.length + inFlight.size; }
function jitterDelay() {
    return sleep(config_1.config.messageDelayMin + Math.random() * (config_1.config.messageDelayMax - config_1.config.messageDelayMin));
}
const backoffDelay = (attempt) => Math.min(1000 * Math.pow(2, attempt), 300_000);
/** DB writes in the delivery path must never throw out of the queue loop. */
function safeDb(label, fn) {
    try {
        fn();
    }
    catch (err) {
        logger_1.logger.error({ err, label }, 'Database write failed in delivery path');
    }
}
function remember(id, message) {
    if (!id || !message)
        return;
    sentCache.set(id, message);
    if (sentCache.size > SENT_CACHE_MAX)
        sentCache.delete(sentCache.keys().next().value);
}
// ── Direct (OTP) send ─────────────────────────────────────────────────────────
async function sendDirectMessage(recipientJid, text) {
    if (connectionStatus !== 'connected' || !sock)
        throw new Error('WhatsApp service is disconnected. Cannot deliver message.');
    const result = await (0, http_1.withTimeout)(sock.sendMessage(recipientJid, { text }), config_1.config.sendTimeoutMs, 'WhatsApp send');
    remember(result?.key?.id, result?.message);
    return result?.key?.id ?? null;
}
// ── Queue drain ───────────────────────────────────────────────────────────────
const TRANSIENT = /connection closed|not connected|stream errored|socket|precondition required/i;
async function deliver(msg) {
    const db = (0, db_1.getDb)();
    try {
        const result = await (0, http_1.withTimeout)(sock.sendMessage(msg.recipient, { text: msg.body }), config_1.config.sendTimeoutMs, 'WhatsApp send');
        remember(result?.key?.id, result?.message);
        const waId = result?.key?.id ?? null;
        safeDb('mark-sent', () => db.prepare(`UPDATE messages SET status='sent', wa_message_id=?, sent_at=datetime('now') WHERE id=?`).run(waId, msg.messageId));
        logger_1.logger.info({ messageId: msg.messageId, waId }, 'Message sent');
    }
    catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        // A timed-out send may still have been delivered later, so say so instead of implying a clean failure.
        const error = /timed out after/.test(raw) ? 'Send timed out — WhatsApp may still have delivered it. Check the phone before retrying.' : raw;
        const attempt = (msg.attempt ?? 0) + 1;
        if (TRANSIENT.test(raw) && attempt < config_1.config.sendMaxAttempts) {
            logger_1.logger.warn({ messageId: msg.messageId, attempt, error }, 'Transient send failure — will retry');
            messageQueue.unshift({ ...msg, attempt });
            await sleep(Math.min(2000 * attempt, 10_000));
            return;
        }
        safeDb('mark-failed', () => db.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).run(error, msg.messageId));
        logger_1.logger.error({ messageId: msg.messageId, error }, 'Failed to send message');
    }
}
async function drainQueue() {
    if (draining || connectionStatus !== 'connected')
        return;
    draining = true;
    try {
        while (messageQueue.length > 0 && connectionStatus === 'connected' && sock) {
            const msg = messageQueue.shift();
            inFlight.add(msg.messageId);
            try {
                await deliver(msg);
            }
            finally {
                inFlight.delete(msg.messageId);
            }
            if (messageQueue.length > 0)
                await jitterDelay();
        }
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Queue drain aborted unexpectedly');
    }
    finally {
        draining = false;
    }
}
const kickDrain = () => setImmediate(() => { drainQueue().catch((err) => logger_1.logger.error({ err }, 'drainQueue rejected')); });
// ── Queue recovery ────────────────────────────────────────────────────────────
function loadPendingMessagesFromDb() {
    try {
        const db = (0, db_1.getDb)();
        const room = Math.max(0, config_1.config.maxQueueSize - messageQueue.length);
        if (room === 0)
            return;
        const pending = db.prepare(`SELECT id, recipient, body FROM messages WHERE status = 'queued' ORDER BY id ASC LIMIT ?`).all(room + inFlight.size + messageQueue.length);
        let loaded = 0;
        for (const row of pending) {
            if (inFlight.has(row.id) || messageQueue.some((q) => q.messageId === row.id))
                continue; // never enqueue a row that is queued OR mid-send
            if (messageQueue.length >= config_1.config.maxQueueSize)
                break;
            if (row.body === config_1.REDACTED_BODY) {
                // REDACT_BODIES stores a placeholder, so the original text is gone. Never send the placeholder to a real recipient.
                safeDb('fail-redacted', () => db.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).run('Server restarted before delivery and message body was redacted, so it could not be recovered. Please resend.', row.id));
                continue;
            }
            messageQueue.push({ messageId: row.id, recipient: row.recipient.includes('@') ? row.recipient : toJid(row.recipient), body: row.body });
            loaded++;
        }
        if (loaded > 0)
            logger_1.logger.info({ count: loaded }, 'Recovered queued messages from database');
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Failed to load queued messages from database');
    }
}
// ── Connection lifecycle ──────────────────────────────────────────────────────
function teardownSocket() {
    const old = sock;
    sock = null;
    if (!old)
        return;
    try {
        old.ev.removeAllListeners?.('connection.update');
        old.ev.removeAllListeners?.('creds.update');
    }
    catch { /* ignore */ }
    try {
        old.end(undefined);
    }
    catch { /* ignore */ }
}
function scheduleReconnect(delay) {
    if (stopped)
        return;
    if (reconnectTimer)
        clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWhatsApp().catch((err) => {
            // Reconnect itself failed (e.g. unreadable auth_state): keep backing off instead of dying.
            connectionStatus = 'disconnected';
            const next = backoffDelay(reconnectAttempts++);
            logger_1.logger.error({ err, retryInMs: next }, 'Reconnect attempt threw — retrying');
            logConnectionEvent('RECONNECT_ERROR', `${err.message} retry_in=${next}ms`);
            scheduleReconnect(next);
        });
    }, delay);
}
function connectWhatsApp() {
    if (connecting)
        return connecting; // one connect at a time — no duplicate sockets
    connecting = doConnect().finally(() => { connecting = null; });
    return connecting;
}
async function doConnect() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    connectionStatus = 'connecting';
    logger_1.logger.info({ attempt: reconnectAttempts }, 'Connecting to WhatsApp...');
    if (reconnectAttempts === 0)
        logConnectionEvent('STARTUP', 'initiating connection');
    fs_1.default.mkdirSync(config_1.config.authStatePath, { recursive: true });
    const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(config_1.config.authStatePath);
    // Never let a hanging network call wedge the single-flight connect: fall back to the library's bundled version.
    const latest = await (0, http_1.withTimeout)((0, baileys_1.fetchLatestBaileysVersion)(), 8000, 'fetchLatestBaileysVersion').catch((err) => {
        logger_1.logger.warn({ err: err.message }, 'Could not fetch latest WhatsApp Web version — using library default');
        return null;
    });
    teardownSocket();
    qrSeen = false;
    const baileysLog = logger_1.logger.child({ mod: 'baileys' }, { level: 'warn' });
    const mine = (0, baileys_1.default)({
        ...(latest && latest.version ? { version: latest.version } : {}),
        auth: { creds: state.creds, keys: (0, baileys_1.makeCacheableSignalKeyStore)(state.keys, baileysLog) },
        logger: baileysLog,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        getMessage: async (key) => (key.id ? sentCache.get(key.id) : undefined),
    });
    sock = mine;
    mine.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (sock !== mine)
            return; // ignore events from superseded sockets
        if (qr) {
            qrSeen = true;
            logger_1.logger.debug('QR generated (phone-number pairing is used instead)');
        }
        if (connection === 'open') {
            const neededAttempts = reconnectAttempts;
            connectionStatus = 'connected';
            reconnectAttempts = 0;
            lastConnectedAt = new Date();
            pairingIssuedAt = null;
            logger_1.logger.info('WhatsApp connected');
            logConnectionEvent('CONNECTED', `reconnect_attempts_needed=${neededAttempts}`);
            loadPendingMessagesFromDb();
            kickDrain();
            return;
        }
        if (connection === 'connecting') {
            connectionStatus = 'connecting';
            return;
        }
        if (connection === 'close') {
            connectionStatus = 'disconnected';
            const code = lastDisconnect?.error?.output?.statusCode;
            lastDisconnectCode = code;
            logger_1.logger.warn({ code }, 'WhatsApp connection closed');
            if (code === baileys_1.DisconnectReason.loggedOut) {
                logger_1.logger.error('WhatsApp logged out (401). Session cleared — pair again from the admin console.');
                logConnectionEvent('LOGGED_OUT', 'code=401 session cleared — re-pairing required');
                wipeAuthState();
                teardownSocket();
                return;
            }
            if (code === 440) { // connectionReplaced — another server is using this session; reconnecting would make the two kick each other forever
                logger_1.logger.error('WhatsApp session was replaced by another instance (440). Auto-reconnect is paused — run only ONE server per session, then restart or re-pair.');
                logConnectionEvent('REPLACED', 'code=440 auto-reconnect paused');
                return;
            }
            const delay = code === baileys_1.DisconnectReason.restartRequired ? 0 : backoffDelay(reconnectAttempts++);
            logConnectionEvent('DISCONNECTED', `code=${code} reconnect_in=${delay}ms attempt=${reconnectAttempts}`);
            scheduleReconnect(delay);
        }
    });
    mine.ev.on('creds.update', saveCreds);
}
function wipeAuthState() {
    try {
        fs_1.default.rmSync(config_1.config.authStatePath, { recursive: true, force: true });
        fs_1.default.mkdirSync(config_1.config.authStatePath, { recursive: true });
    }
    catch { /* ignore */ }
}
/** Start (or resume) the WhatsApp connection; never throws — failures are retried with backoff. */
function startWhatsApp() {
    stopped = false;
    connectWhatsApp().catch((err) => {
        connectionStatus = 'disconnected';
        logger_1.logger.warn({ err }, 'Initial WhatsApp connection failed — retrying automatically');
        scheduleReconnect(backoffDelay(reconnectAttempts++));
    });
    // Reconcile: rows left 'queued' in the DB (e.g. queue was full) get picked up without a restart.
    if (!reconcileTimer) { // singleton — unlink() calls startWhatsApp() again and must not stack intervals
        reconcileTimer = setInterval(() => { if (connectionStatus === 'connected') {
            loadPendingMessagesFromDb();
            kickDrain();
        } }, 60_000);
        reconcileTimer.unref();
    }
}
// ── Pairing / unlinking ───────────────────────────────────────────────────────
async function requestPairing(digits) {
    if (connectionStatus === 'connected')
        throw new http_1.HttpError(409, 'already_connected', 'WhatsApp is already connected. Unlink the current session first if you want to pair a different number.');
    // A socket left over from a closed connection (QR/pairing window timed out, backoff pending) cannot issue codes — start a fresh one.
    if (!sock || connectionStatus === 'disconnected') {
        teardownSocket();
        reconnectAttempts = 0;
        await connectWhatsApp();
    }
    if (!sock)
        throw new http_1.HttpError(503, 'socket_unavailable', 'Could not initialise a WhatsApp socket. Try again in a few seconds.');
    if (sock.authState.creds.registered) {
        throw new http_1.HttpError(409, 'session_exists', 'A linked session already exists and is reconnecting. Wait a moment, or unlink it to pair again.');
    }
    // Pairing codes are only accepted after the socket's handshake finished (signalled by the first QR event).
    for (let waited = 0; !qrSeen && connectionStatus === 'connecting' && sock && waited < 10_000; waited += 200)
        await sleep(200);
    if (!sock || !qrSeen)
        throw new http_1.HttpError(503, 'socket_not_ready', 'WhatsApp is not ready to issue a pairing code yet. Try again in a few seconds.');
    logger_1.logger.info('Requesting pairing code');
    const code = await sock.requestPairingCode(digits);
    pairingIssuedAt = new Date();
    return code;
}
/** Log out from WhatsApp, delete local credentials and prepare a fresh socket for pairing. */
async function unlinkSession() {
    try {
        await (0, http_1.withTimeout)(Promise.resolve(sock?.logout()), 5000, 'logout');
    }
    catch (err) {
        logger_1.logger.warn({ err }, 'logout() failed — wiping local session anyway');
    }
    teardownSocket();
    wipeAuthState();
    connectionStatus = 'disconnected';
    pairingIssuedAt = null;
    reconnectAttempts = 0;
    logConnectionEvent('UNLINKED', 'session removed by admin');
    setTimeout(() => { if (!stopped)
        startWhatsApp(); }, 500).unref();
}
// ── Queue API ─────────────────────────────────────────────────────────────────
function enqueueMessage(msg, priority = false) {
    if (messageQueue.length >= config_1.config.maxQueueSize) {
        throw new http_1.HttpError(503, 'queue_full', `Message queue full (limit: ${config_1.config.maxQueueSize}). WhatsApp may be disconnected — retry shortly.`, { retry_after_seconds: 30 });
    }
    if (priority)
        messageQueue.unshift(msg);
    else
        messageQueue.push(msg);
    if (connectionStatus === 'connected')
        kickDrain();
}
/** Graceful shutdown: let the current send finish (up to maxMs), then close the socket. */
async function closeWhatsApp(maxMs = 8000) {
    stopped = true;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (reconcileTimer) {
        clearInterval(reconcileTimer);
        reconcileTimer = null;
    }
    const until = Date.now() + maxMs;
    while (inFlight.size > 0 && Date.now() < until)
        await sleep(100);
    teardownSocket();
    connectionStatus = 'disconnected';
}
//# sourceMappingURL=client.js.map