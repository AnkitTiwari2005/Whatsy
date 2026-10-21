import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import path from 'path';
import { config, REDACTED_BODY } from '../config';
import { logger } from '../logger';
import { getDb } from '../db';
import { HttpError, withTimeout } from '../util/http';
import { normalizePhone } from '../util/phone';

function logConnectionEvent(event: string, detail?: string): void {
  const line = `${new Date().toISOString()} | ${event}${detail ? ' | ' + detail : ''}\n`;
  const file = path.join(config.dataDir, 'connection.log');
  try {
    try { if (fs.statSync(file).size > 1_000_000) fs.renameSync(file, file + '.1'); } catch { /* no file yet */ }   // keep the log bounded
    fs.appendFileSync(file, line);
  } catch { /* never crash over logging */ }
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
export interface QueuedMessage { messageId: number; recipient: string; body: string; attempt?: number }

// ── State ─────────────────────────────────────────────────────────────────────
let sock: WASocket | null = null;
let connectionStatus: ConnectionStatus = 'disconnected';
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connecting: Promise<void> | null = null;
let stopped = false;
let draining = false;
let lastConnectedAt: Date | null = null;
let lastDisconnectCode: number | undefined;
let pairingIssuedAt: Date | null = null;
let qrSeen = false;                          // true once the current socket finished its handshake (safe to request a pairing code)
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let credsCache: { mtime: number; registered: boolean } | null = null;
const startedAt = new Date();
const messageQueue: QueuedMessage[] = [];
const inFlight = new Set<number>();            // rows currently being sent (still 'queued' in the DB)
const sentCache = new Map<string, unknown>();  // recent outbound content, needed so WhatsApp retry requests re-send the REAL message
const SENT_CACHE_MAX = 500;

// ── Helpers ───────────────────────────────────────────────────────────────────
export { normalizePhone } from '../util/phone';
export function toJid(phone: string): string {
  const norm = normalizePhone(phone);
  const digits = norm.ok ? norm.digits : phone.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isWhatsAppReady(): boolean {
  return connectionStatus === 'connected' && sock !== null && Boolean(sock.user || (sock.authState?.creds as any)?.me);
}

/** creds.json exists even for a half-finished pairing, so read its real `registered` flag (cached by mtime). */
function registeredOnDisk(): boolean {
  try {
    const f = path.join(config.authStatePath, 'creds.json');
    const m = fs.statSync(f).mtimeMs;
    if (credsCache && credsCache.mtime === m) return credsCache.registered;
    const registered = JSON.parse(fs.readFileSync(f, 'utf8')).registered === true;
    credsCache = { mtime: m, registered };
    return registered;
  } catch { return false; }
}

export function getStatus() {
  const registered = sock ? Boolean((sock.authState?.creds as any)?.registered) : registeredOnDisk();
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
export function getQueueLength(): number { return messageQueue.length + inFlight.size; }

function jitterDelay(): Promise<void> {
  return sleep(config.messageDelayMin + Math.random() * (config.messageDelayMax - config.messageDelayMin));
}
const backoffDelay = (attempt: number) => Math.min(1000 * Math.pow(2, attempt), 300_000);

/** DB writes in the delivery path must never throw out of the queue loop. */
function safeDb(label: string, fn: () => void): void {
  try { fn(); } catch (err) { logger.error({ err, label }, 'Database write failed in delivery path'); }
}
function remember(id: string | null | undefined, message: unknown): void {
  if (!id || !message) return;
  sentCache.set(id, message);
  if (sentCache.size > SENT_CACHE_MAX) sentCache.delete(sentCache.keys().next().value as string);
}

// ── Direct (OTP) send ─────────────────────────────────────────────────────────
export async function sendDirectMessage(recipientJid: string, text: string): Promise<string | null> {
  if (connectionStatus !== 'connected' || !sock) throw new Error('WhatsApp service is disconnected. Cannot deliver message.');
  const result = await withTimeout(sock.sendMessage(recipientJid, { text }), config.sendTimeoutMs, 'WhatsApp send');
  remember(result?.key?.id, result?.message);
  return result?.key?.id ?? null;
}

// ── Queue drain ───────────────────────────────────────────────────────────────
const TRANSIENT = /connection closed|not connected|stream errored|socket|precondition required/i;

async function deliver(msg: QueuedMessage): Promise<void> {
  const db = getDb();
  try {
    const result = await withTimeout(sock!.sendMessage(msg.recipient, { text: msg.body }), config.sendTimeoutMs, 'WhatsApp send');
    remember(result?.key?.id, result?.message);
    const waId = result?.key?.id ?? null;
    safeDb('mark-sent', () => db.prepare(`UPDATE messages SET status='sent', wa_message_id=?, sent_at=datetime('now') WHERE id=?`).run(waId, msg.messageId));
    logger.info({ messageId: msg.messageId, waId }, 'Message sent');
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // A timed-out send may still have been delivered later, so say so instead of implying a clean failure.
    const error = /timed out after/.test(raw) ? 'Send timed out — WhatsApp may still have delivered it. Check the phone before retrying.' : raw;
    const attempt = (msg.attempt ?? 0) + 1;
    if (TRANSIENT.test(raw) && attempt < config.sendMaxAttempts) {
      logger.warn({ messageId: msg.messageId, attempt, error }, 'Transient send failure — will retry');
      messageQueue.unshift({ ...msg, attempt });
      await sleep(Math.min(2000 * attempt, 10_000));
      return;
    }
    safeDb('mark-failed', () => db.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).run(error, msg.messageId));
    logger.error({ messageId: msg.messageId, error }, 'Failed to send message');
  }
}

async function drainQueue(): Promise<void> {
  if (draining || connectionStatus !== 'connected') return;
  draining = true;
  try {
    while (messageQueue.length > 0 && connectionStatus === 'connected' && sock) {
      const msg = messageQueue.shift()!;
      inFlight.add(msg.messageId);
      try { await deliver(msg); } finally { inFlight.delete(msg.messageId); }
      if (messageQueue.length > 0) await jitterDelay();
    }
  } catch (err) {
    logger.error({ err }, 'Queue drain aborted unexpectedly');
  } finally {
    draining = false;
  }
}
const kickDrain = () => setImmediate(() => { drainQueue().catch((err) => logger.error({ err }, 'drainQueue rejected')); });

// ── Queue recovery ────────────────────────────────────────────────────────────
export function loadPendingMessagesFromDb(): void {
  try {
    const db = getDb();
    const room = Math.max(0, config.maxQueueSize - messageQueue.length);
    if (room === 0) return;
    const pending = db.prepare(`SELECT id, recipient, body FROM messages WHERE status = 'queued' ORDER BY id ASC LIMIT ?`).all(room + inFlight.size + messageQueue.length) as Array<{ id: number; recipient: string; body: string }>;
    let loaded = 0;
    for (const row of pending) {
      if (inFlight.has(row.id) || messageQueue.some((q) => q.messageId === row.id)) continue; // never enqueue a row that is queued OR mid-send
      if (messageQueue.length >= config.maxQueueSize) break;
      if (row.body === REDACTED_BODY) {
        // REDACT_BODIES stores a placeholder, so the original text is gone. Never send the placeholder to a real recipient.
        safeDb('fail-redacted', () => db.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).run('Server restarted before delivery and message body was redacted, so it could not be recovered. Please resend.', row.id));
        continue;
      }
      messageQueue.push({ messageId: row.id, recipient: row.recipient.includes('@') ? row.recipient : toJid(row.recipient), body: row.body });
      loaded++;
    }
    if (loaded > 0) logger.info({ count: loaded }, 'Recovered queued messages from database');
  } catch (err) {
    logger.error({ err }, 'Failed to load queued messages from database');
  }
}

// ── Connection lifecycle ──────────────────────────────────────────────────────
function teardownSocket(): void {
  const old = sock; sock = null;
  if (!old) return;
  try { (old.ev as any).removeAllListeners?.('connection.update'); (old.ev as any).removeAllListeners?.('creds.update'); } catch { /* ignore */ }
  try { old.end(undefined); } catch { /* ignore */ }
}

function scheduleReconnect(delay: number): void {
  if (stopped) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWhatsApp().catch((err) => {
      // Reconnect itself failed (e.g. unreadable auth_state): keep backing off instead of dying.
      connectionStatus = 'disconnected';
      const next = backoffDelay(reconnectAttempts++);
      logger.error({ err, retryInMs: next }, 'Reconnect attempt threw — retrying');
      logConnectionEvent('RECONNECT_ERROR', `${(err as Error).message} retry_in=${next}ms`);
      scheduleReconnect(next);
    });
  }, delay);
}

export function connectWhatsApp(): Promise<void> {
  if (connecting) return connecting;                       // one connect at a time — no duplicate sockets
  connecting = doConnect().finally(() => { connecting = null; });
  return connecting;
}

async function doConnect(): Promise<void> {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  connectionStatus = 'connecting';
  logger.info({ attempt: reconnectAttempts }, 'Connecting to WhatsApp...');
  if (reconnectAttempts === 0) logConnectionEvent('STARTUP', 'initiating connection');

  fs.mkdirSync(config.authStatePath, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(config.authStatePath);
  // Never let a hanging network call wedge the single-flight connect: fall back to the library's bundled version.
  const latest = await withTimeout(fetchLatestBaileysVersion(), 8000, 'fetchLatestBaileysVersion').catch((err) => {
    logger.warn({ err: (err as Error).message }, 'Could not fetch latest WhatsApp Web version — using library default');
    return null;
  });
  teardownSocket();
  qrSeen = false;
  const baileysLog = logger.child({ mod: 'baileys' }, { level: 'warn' }) as any;

  const mine = makeWASocket({
    ...(latest && (latest as any).version ? { version: (latest as any).version } : {}),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLog) },
    logger: baileysLog,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    getMessage: async (key) => (key.id ? (sentCache.get(key.id) as any) : undefined),
  });
  sock = mine;

  mine.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (sock !== mine) return;                             // ignore events from superseded sockets
    if (qr) { qrSeen = true; logger.debug('QR generated (phone-number pairing is used instead)'); }

    if (connection === 'open') {
      const neededAttempts = reconnectAttempts;
      connectionStatus = 'connected'; reconnectAttempts = 0; lastConnectedAt = new Date(); pairingIssuedAt = null;
      logger.info('WhatsApp connected');
      logConnectionEvent('CONNECTED', `reconnect_attempts_needed=${neededAttempts}`);
      loadPendingMessagesFromDb();
      kickDrain();
      return;
    }
    if (connection === 'connecting') { connectionStatus = 'connecting'; return; }

    if (connection === 'close') {
      connectionStatus = 'disconnected';
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      lastDisconnectCode = code;
      logger.warn({ code }, 'WhatsApp connection closed');

      if (code === DisconnectReason.loggedOut) {
        logger.error('WhatsApp logged out (401). Session cleared — pair again from the admin console.');
        logConnectionEvent('LOGGED_OUT', 'code=401 session cleared — re-pairing required');
        wipeAuthState(); teardownSocket();
        return;
      }
      if (code === 440) {   // connectionReplaced — another server is using this session; reconnecting would make the two kick each other forever
        logger.error('WhatsApp session was replaced by another instance (440). Auto-reconnect is paused — run only ONE server per session, then restart or re-pair.');
        logConnectionEvent('REPLACED', 'code=440 auto-reconnect paused');
        return;
      }
      const delay = code === DisconnectReason.restartRequired ? 0 : backoffDelay(reconnectAttempts++);
      logConnectionEvent('DISCONNECTED', `code=${code} reconnect_in=${delay}ms attempt=${reconnectAttempts}`);
      scheduleReconnect(delay);
    }
  });
  mine.ev.on('creds.update', saveCreds);
}

function wipeAuthState(): void {
  try { fs.rmSync(config.authStatePath, { recursive: true, force: true }); fs.mkdirSync(config.authStatePath, { recursive: true }); } catch { /* ignore */ }
}

/** Start (or resume) the WhatsApp connection; never throws — failures are retried with backoff. */
export function startWhatsApp(): void {
  stopped = false;
  connectWhatsApp().catch((err) => {
    connectionStatus = 'disconnected';
    logger.warn({ err }, 'Initial WhatsApp connection failed — retrying automatically');
    scheduleReconnect(backoffDelay(reconnectAttempts++));
  });
  // Reconcile: rows left 'queued' in the DB (e.g. queue was full) get picked up without a restart.
  if (!reconcileTimer) {   // singleton — unlink() calls startWhatsApp() again and must not stack intervals
    reconcileTimer = setInterval(() => { if (connectionStatus === 'connected') { loadPendingMessagesFromDb(); kickDrain(); } }, 60_000);
    reconcileTimer.unref();
  }
}

// ── Pairing / unlinking ───────────────────────────────────────────────────────
export async function requestPairing(digits: string): Promise<string> {
  if (connectionStatus === 'connected') throw new HttpError(409, 'already_connected', 'WhatsApp is already connected. Unlink the current session first if you want to pair a different number.');
  // A socket left over from a closed connection (QR/pairing window timed out, backoff pending) cannot issue codes — start a fresh one.
  if (!sock || connectionStatus === 'disconnected') { teardownSocket(); reconnectAttempts = 0; await connectWhatsApp(); }
  if (!sock) throw new HttpError(503, 'socket_unavailable', 'Could not initialise a WhatsApp socket. Try again in a few seconds.');
  if (sock.authState.creds.registered) {
    throw new HttpError(409, 'session_exists', 'A linked session already exists and is reconnecting. Wait a moment, or unlink it to pair again.');
  }
  // Pairing codes are only accepted after the socket's handshake finished (signalled by the first QR event).
  for (let waited = 0; !qrSeen && connectionStatus === 'connecting' && sock && waited < 10_000; waited += 200) await sleep(200);
  if (!sock || !qrSeen) throw new HttpError(503, 'socket_not_ready', 'WhatsApp is not ready to issue a pairing code yet. Try again in a few seconds.');
  logger.info('Requesting pairing code');
  const code = await sock.requestPairingCode(digits);
  pairingIssuedAt = new Date();
  return code;
}

/** Log out from WhatsApp, delete local credentials and prepare a fresh socket for pairing. */
export async function unlinkSession(): Promise<void> {
  try { await withTimeout(Promise.resolve(sock?.logout()), 5000, 'logout'); } catch (err) { logger.warn({ err }, 'logout() failed — wiping local session anyway'); }
  teardownSocket(); wipeAuthState();
  connectionStatus = 'disconnected'; pairingIssuedAt = null; reconnectAttempts = 0;
  logConnectionEvent('UNLINKED', 'session removed by admin');
  setTimeout(() => { if (!stopped) startWhatsApp(); }, 500).unref();
}

// ── Queue API ─────────────────────────────────────────────────────────────────
export function enqueueMessage(msg: QueuedMessage, priority = false): void {
  if (messageQueue.length >= config.maxQueueSize) {
    throw new HttpError(503, 'queue_full', `Message queue full (limit: ${config.maxQueueSize}). WhatsApp may be disconnected — retry shortly.`, { retry_after_seconds: 30 });
  }
  if (priority) messageQueue.unshift(msg); else messageQueue.push(msg);
  if (connectionStatus === 'connected') kickDrain();
}

/** Graceful shutdown: let the current send finish (up to maxMs), then close the socket. */
export async function closeWhatsApp(maxMs = 8000): Promise<void> {
  stopped = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (reconcileTimer) { clearInterval(reconcileTimer); reconcileTimer = null; }
  const until = Date.now() + maxMs;
  while (inFlight.size > 0 && Date.now() < until) await sleep(100);
  teardownSocket();
  connectionStatus = 'disconnected';
}
