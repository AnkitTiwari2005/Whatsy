'use strict';
/**
 * Test-only preload. Replaces ONLY the WhatsApp transport (Baileys) with a controllable fake,
 * so the app's real routes, auth, queue and OTP logic run unmodified.
 * Set WHATSY_SQLITE_SHIM=1 to map better-sqlite3 onto node:sqlite (for machines without the native build).
 * A tiny control server (WA_CTL_PORT) lets tests inject latency/failures and inspect delivered messages.
 */
const Module = require('module');
const origLoad = Module._load;

class ShimDatabase {
  constructor(p) { const { DatabaseSync } = require('node:sqlite'); this.db = new DatabaseSync(p); }
  pragma(s) { try { this.db.exec('PRAGMA ' + s); } catch (_) {} return []; }
  exec(s) { this.db.exec(s); return this; }
  close() { this.db.close(); }
  prepare(sql) {
    const st = this.db.prepare(sql);
    const norm = (a) => a.map((v) => (typeof v === 'boolean' ? (() => { throw new TypeError('SQLite3 can only bind numbers, strings, bigints, buffers, and null'); })() : v));
    return {
      run: (...a) => { const r = st.run(...norm(a)); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; },
      get: (...a) => st.get(...norm(a)), all: (...a) => st.all(...norm(a)),
    };
  }
  transaction(fn) {
    return (...args) => { this.db.exec('BEGIN'); try { const r = fn(...args); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } };
  }
}

const W = (globalThis.__wa = { sent: [], latencyMs: 0, failNext: 0, authFail: 0, sockets: 0, handlers: null });
function makeWASocket() {
  W.sockets++;
  const handlers = {};
  const sock = {
    user: { id: '1@s.whatsapp.net' },
    authState: { creds: { registered: true, me: {} } },
    ev: { on: (e, f) => { handlers[e] = f; }, removeAllListeners: () => {} },
    end() {}, async logout() {},
    sendMessage: async (jid, content) => {
      if (W.latencyMs) await new Promise((r) => setTimeout(r, W.latencyMs));
      if (W.failNext > 0) { W.failNext--; throw new Error('simulated send failure'); }
      W.sent.push({ jid, text: content.text });
      return { key: { id: 'WAID' + W.sent.length }, message: { conversation: content.text } };
    },
    requestPairingCode: async () => 'ABCD1234',
  };
  W.handlers = handlers;
  setTimeout(() => handlers['connection.update'] && handlers['connection.update']({ connection: 'open' }), 20);
  return sock;
}
const fakeBaileys = {
  __esModule: true, default: makeWASocket,
  DisconnectReason: { loggedOut: 401, restartRequired: 515 },
  useMultiFileAuthState: async () => {
    if (W.authFail) throw new Error('simulated auth-state read failure (EIO)');
    return { state: { creds: { registered: true }, keys: {} }, saveCreds: () => {} };
  },
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
  makeCacheableSignalKeyStore: (k) => k,
};
Module._load = function (req, ...rest) {
  if (req === 'better-sqlite3' && process.env.WHATSY_SQLITE_SHIM === '1') return ShimDatabase;
  if (req === '@whiskeysockets/baileys') return fakeBaileys;
  return origLoad.call(this, req, ...rest);
};

require('http').createServer((rq, rs) => {
  const u = new URL(rq.url, 'http://x'); const q = u.searchParams; let out = { ok: true };
  if (u.pathname === '/set') { for (const k of ['latencyMs', 'failNext', 'authFail']) if (q.has(k)) W[k] = +q.get(k); }
  if (u.pathname === '/reset') { W.sent.length = 0; W.latencyMs = 0; W.failNext = 0; W.authFail = 0; }
  if (u.pathname === '/reopen') W.handlers['connection.update']({ connection: 'open' });
  if (u.pathname === '/close') W.handlers['connection.update']({ connection: 'close', lastDisconnect: { error: { output: { statusCode: +(q.get('code') || 428) } } } });
  if (u.pathname === '/sigterm') { rs.setHeader('content-type', 'application/json'); rs.end(JSON.stringify({ ok: true })); setImmediate(() => process.emit('SIGTERM')); return; }
  if (u.pathname === '/sent') out = { sent: W.sent.map((s) => ({ jid: s.jid, text: s.text })), sockets: W.sockets };
  rs.setHeader('content-type', 'application/json'); rs.end(JSON.stringify(out));
}).listen(+(process.env.WA_CTL_PORT || 3999), '127.0.0.1');
