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
import { config } from '../config';
import { logger } from '../logger';
import { getDb } from '../db';

// ── Connection event log ──────────────────────────────────────────────────────
// Appends one line per connection state change to DATA_DIR/connection.log
// Use this file to evaluate stability during a soak test.
function logConnectionEvent(event: string, detail?: string): void {
  const line = `${new Date().toISOString()} | ${event}${detail ? ' | ' + detail : ''}\n`;
  const logPath = path.join(config.dataDir, 'connection.log');
  try {
    fs.appendFileSync(logPath, line);
  } catch { /* don't crash the app over logging */ }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface QueuedMessage {
  messageId: number;   // DB row id
  recipient: string;   // JID e.g. 919876543210@s.whatsapp.net
  body: string;
}

// ── State ─────────────────────────────────────────────────────────────────────

let sock: WASocket | null = null;
let connectionStatus: ConnectionStatus = 'disconnected';
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let startedAt: Date = new Date();
const messageQueue: QueuedMessage[] = [];
let draining = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert E.164 number (+919876543210 or 919876543210) to WhatsApp JID */
export function toJid(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

export function getStatus(): { status: ConnectionStatus; uptime_seconds: number } {
  return {
    status: connectionStatus,
    uptime_seconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
  };
}

/** Jitter delay between MESSAGE_DELAY_MIN_MS and MESSAGE_DELAY_MAX_MS */
function jitterDelay(): Promise<void> {
  const ms =
    config.messageDelayMin +
    Math.random() * (config.messageDelayMax - config.messageDelayMin);
  return new Promise((r) => setTimeout(r, ms));
}

/** Exponential backoff: 1s -> 2s -> 4s -> ... capped at 300s */
function backoffDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 300_000);
}

// ── Message queue drain ───────────────────────────────────────────────────────

async function drainQueue(): Promise<void> {
  if (draining || connectionStatus !== 'connected') return;
  draining = true;

  const db = getDb();

  while (messageQueue.length > 0 && connectionStatus === 'connected') {
    const msg = messageQueue.shift()!;
    try {
      const result = await sock!.sendMessage(msg.recipient, { text: msg.body });
      const waId = result?.key?.id ?? null;

      db.prepare(
        `UPDATE messages SET status='sent', wa_message_id=?, sent_at=datetime('now') WHERE id=?`
      ).run(waId, msg.messageId);

      logger.info({ messageId: msg.messageId, recipient: msg.recipient, waId }, 'Message sent');
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      db.prepare(
        `UPDATE messages SET status='failed', error=? WHERE id=?`
      ).run(error, msg.messageId);
      logger.error({ messageId: msg.messageId, error }, 'Failed to send message');
    }

    if (messageQueue.length > 0) {
      await jitterDelay();
    }
  }

  draining = false;
}

// ── Core connect function ─────────────────────────────────────────────────────

export async function connectWhatsApp(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  connectionStatus = 'connecting';
  logger.info({ attempt: reconnectAttempts }, 'Connecting to WhatsApp...');
  if (reconnectAttempts === 0) {
    logConnectionEvent('STARTUP', 'server started, initiating first connection');
  }

  fs.mkdirSync(config.authStatePath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(config.authStatePath);
  const { version } = await fetchLatestBaileysVersion();

  logger.debug({ version }, 'Baileys version');

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger as any),
    },
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    getMessage: async (_key) => ({ conversation: '' }),
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      logger.warn('QR code generated — use phone-number pairing via POST /admin/pair instead');
    }

    if (connection === 'open') {
      connectionStatus = 'connected';
      reconnectAttempts = 0;
      logger.info('WhatsApp connected');
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
      const err = lastDisconnect?.error as Boom | undefined;
      const code = err?.output?.statusCode;

      logger.warn({ code }, 'WhatsApp connection closed');

      // 401 = loggedOut — wipe session and do NOT auto-reconnect
      if (code === DisconnectReason.loggedOut) {
        logger.error(
          'WhatsApp logged out (401). Session cleared. Call POST /admin/pair to re-authenticate.'
        );
        logConnectionEvent('LOGGED_OUT', 'code=401 session cleared — re-pairing required');
        try {
          fs.rmSync(config.authStatePath, { recursive: true, force: true });
          fs.mkdirSync(config.authStatePath, { recursive: true });
        } catch { /* ignore */ }
        sock = null;
        return;
      }

      // 515 = restartRequired — reconnect immediately
      const delay = code === DisconnectReason.restartRequired
        ? 0
        : backoffDelay(reconnectAttempts++);

      logConnectionEvent('DISCONNECTED', `code=${code} reconnect_in=${delay}ms attempt=${reconnectAttempts}`);
      logger.info({ delayMs: delay, attempt: reconnectAttempts }, 'Scheduling reconnect');
      reconnectTimer = setTimeout(connectWhatsApp, delay);
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

// ── Pairing code ──────────────────────────────────────────────────────────────

export async function requestPairing(phoneNumber: string): Promise<string> {
  if (!sock) {
    await connectWhatsApp();
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (!sock) throw new Error('Failed to initialise WhatsApp socket');

  if (sock.authState.creds.registered) {
    throw new Error(
      'WhatsApp is already paired. Revoke the session first via the auth_state directory.'
    );
  }

  const digits = phoneNumber.replace(/\D/g, '');
  logger.info({ phone: digits }, 'Requesting pairing code');

  const code = await sock.requestPairingCode(digits);
  return code;
}

// ── Queue ─────────────────────────────────────────────────────────────────────

export function enqueueMessage(msg: QueuedMessage): void {
  if (messageQueue.length >= config.maxQueueSize) {
    throw new Error(`Message queue full (limit: ${config.maxQueueSize}). WhatsApp may be disconnected.`);
  }
  messageQueue.push(msg);
  logger.debug({ messageId: msg.messageId, queueLength: messageQueue.length }, 'Message enqueued');
  if (connectionStatus === 'connected') {
    setImmediate(() => drainQueue());
  }
}

export function getQueueLength(): number {
  return messageQueue.length;
}