'use strict';
/**
 * Whatsy regression suite — every test asserts the behaviour the gateway SHOULD have.
 * IDs (R-, S-, A-, O-) map 1:1 to the findings in the audit report.
 * Run:  npm test            (needs dist/ built:  npm run build:local)
 * No native build available? WHATSY_SQLITE_SHIM=1 npm test   (maps better-sqlite3 onto node:sqlite)
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, sleep } = require('./helpers/harness');

const code = (t) => (String(t).match(/\*(\d{4,8})\*/) || [])[1];
const openDb = (dir) => { const p = path.join(dir, 'whatsy.db'); if (process.env.WHATSY_SQLITE_SHIM === '1') { const { DatabaseSync } = require('node:sqlite'); return new DatabaseSync(p); } return new (require('better-sqlite3'))(p); };

/* ───────────────────────────── A. API input handling ───────────────────────────── */
describe('A. API input handling', () => {
  let s, key, h;
  before(async () => { s = await startServer(); const p = await s.project('t-api', { default_recipient: '+919876543210' }); key = p.api_key; h = { 'X-Api-Key': key }; });
  after(async () => s.kill());

  it('[A-01] missing body → 400, wrong Content-Type → 400/415, never 500', async () => {
    const a = await s.req('POST', '/api/v1/messages', { headers: h });
    const b = await s.req('POST', '/api/v1/messages', { headers: { ...h, 'Content-Type': 'text/plain' }, raw: 'hi' });
    const c = await s.req('POST', '/admin/projects', { headers: { 'X-Admin-Key': require('./helpers/harness').ADMIN_KEY } });
    assert.equal(a.status, 400); assert.ok([400, 415].includes(b.status), 'text/plain got ' + b.status); assert.equal(c.status, 400);
  });
  it('[A-02] malformed JSON → 400 and oversize body → 413', async () => {
    const bad = await s.req('POST', '/api/v1/messages', { headers: { ...h, 'Content-Type': 'application/json' }, raw: '{bad' });
    const big = await s.req('POST', '/api/v1/messages', { headers: { ...h, 'Content-Type': 'application/json' }, raw: JSON.stringify({ message: 'x'.repeat(70000) }) });
    assert.equal(bad.status, 400); assert.equal(big.status, 413);
  });
  it('[A-03a] numeric recipient is handled (accepted or 400), not a 500', async () => {
    const r = await s.req('POST', '/api/v1/messages', { headers: h, body: { message: 'hi', recipient: 919876543210 } });
    assert.ok([202, 400].includes(r.status), 'got ' + r.status);
  });
  it('[A-03b] free text that merely contains digits is rejected as a recipient', async () => {
    const r = await s.req('POST', '/api/v1/messages', { headers: h, body: { message: 'hi', recipient: 'call me on 9876543210 asap' } });
    assert.equal(r.status, 400);
  });
  it('[A-04] limit=-1 cannot bypass the page-size cap', async () => {
    const p = await s.project('t-limit'); const db = openDb(s.dataDir);
    db.exec('BEGIN'); const ins = db.prepare(`INSERT INTO messages (project_id, recipient, body, status) VALUES (?, '+919000000000', 'seed', 'sent')`);
    for (let i = 0; i < 620; i++) ins.run(p.id); db.exec('COMMIT'); db.close();
    const r = await s.admin('GET', '/admin/messages?limit=-1');
    assert.ok(r.status === 400 || (r.status === 200 && r.json.messages.length <= 500), `returned ${r.json && r.json.messages && r.json.messages.length} rows`);
  });
  it('[A-04b] unknown status filter is rejected instead of silently ignored', async () => {
    assert.equal((await s.admin('GET', '/admin/messages?status=bogus')).status, 400);
  });
  it('[A-05a] PATCH can clear description/default_recipient with null', async () => {
    const p = await s.project('t-patch', { description: 'd', default_recipient: '+911111111111' });
    await s.admin('PATCH', `/admin/projects/${p.id}`, { description: null, default_recipient: null });
    const row = (await s.admin('GET', '/admin/projects')).json.find((x) => x.id === p.id);
    assert.equal(row.default_recipient, null); assert.equal(row.description, null);
  });
  it('[A-05b] PATCH rejects non-boolean "active" (string "false" is not silently truthy)', async () => {
    const p = await s.project('t-bool');
    assert.equal((await s.admin('PATCH', `/admin/projects/${p.id}`, { active: 'false' })).status, 400);
  });
  it('[A-06] project names are unique case-/space-insensitively and length-bounded', async () => {
    assert.equal((await s.admin('POST', '/admin/projects', { name: 'Shop' })).status, 201);
    assert.equal((await s.admin('POST', '/admin/projects', { name: ' shop ' })).status, 409);
    assert.equal((await s.admin('POST', '/admin/projects', { name: 'n'.repeat(10000) })).status, 400);
  });
  it('[A-07] API timestamps are unambiguous ISO-8601 UTC (…Z)', async () => {
    await s.req('POST', '/api/v1/messages', { headers: h, body: { message: 'ts', recipient: '+919876543210' } });
    const m = (await s.admin('GET', '/admin/messages?limit=1')).json.messages[0];
    assert.match(m.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
  });
  it('[A-08] /health reflects dependencies (DB reachable) and returns JSON', async () => {
    const r = await s.req('GET', '/health'); assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.ok('db' in r.json);
  });
});

/* ───────────────────────────── S. Security ───────────────────────────── */
describe('S. Security', () => {
  let s;
  before(async () => { s = await startServer(); });
  after(async () => s.kill());

  it('[S-03] foreign origins get no CORS allowance on admin or API routes', async () => {
    const r = await s.req('OPTIONS', '/admin/projects', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-admin-key' } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  });
  it('[S-04] a Content-Security-Policy is sent and forbids framing', async () => {
    const r = await s.req('GET', '/admin/ui/'); const csp = r.headers.get('content-security-policy') || '';
    assert.ok(/default-src/.test(csp) && /frame-ancestors/.test(csp), 'CSP: ' + csp);
  });
  it('[S-04b] the admin UI ships no inline <script> blocks and no external font/CDN calls', async () => {
    const html = (await s.req('GET', '/admin/ui/')).text;
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html), 'inline script present');
    assert.ok(!/fonts\.googleapis\.com|cdn\.|unpkg\.com/.test(html), 'external resource present');
  });
  it('[S-08] the UI does not persist project API keys in localStorage', async () => {
    const files = ['index.html', 'admin.js'].map((f) => { try { return fs.readFileSync(path.join(__dirname, '..', 'dist', 'admin-ui', f), 'utf8'); } catch (_) { return ''; } }).join('\n');
    assert.ok(!/localStorage\.setItem\(\s*['"]last_otp_key['"]/.test(files));
    assert.ok(!/localStorage\.setItem\(\s*['"]wk['"]/.test(files), 'admin key stored in localStorage');
  });
  it('[S-05] API-key lookup is O(1): authenticated request is not CPU-bound on bcrypt', async () => {
    const p = await s.project('t-perf'); const h = { 'X-Api-Key': p.api_key };
    await s.req('POST', '/api/v1/messages', { headers: h, body: { message: '' } }); // warm
    const t = Date.now(); for (let i = 0; i < 8; i++) await s.req('POST', '/api/v1/messages', { headers: h, body: { message: '' } });
    const avg = (Date.now() - t) / 8; assert.ok(avg < 25, `avg ${avg.toFixed(1)} ms per authenticated request`);
  });
  it('[S-06] legacy bcrypt API keys keep working after the upgrade (backward compatible)', async () => {
    const bcrypt = require('bcryptjs'); const raw = 'legacyKEY' + 'x'.repeat(30); const db = openDb(s.dataDir);
    const p = await s.project('t-legacy', { default_recipient: '+919876543210' });
    db.prepare(`INSERT INTO api_keys (project_id, key_hash, key_prefix, label) VALUES (?, ?, ?, 'legacy')`).run(p.id, bcrypt.hashSync(raw, 8), raw.slice(0, 8)); db.close();
    const r = await s.req('POST', '/api/v1/messages', { headers: { 'X-Api-Key': raw }, body: { message: 'legacy ok' } });
    assert.equal(r.status, 202);
  });
});

describe('S-01. Admin key lockout', () => {
  let s;
  before(async () => { s = await startServer(); });
  after(async () => s.kill());
  it('[S-01] repeated wrong admin keys are throttled (429)', async () => {
    const seen = new Set();
    for (let i = 0; i < 40; i++) seen.add((await s.req('GET', '/admin/projects', { headers: { 'X-Admin-Key': 'guess-' + i } })).status);
    assert.ok(seen.has(429), 'statuses seen: ' + [...seen]);
  });
});

/* ───────────────── S-02. Unauthenticated traffic must not lock out customers ───────────────── */
describe('S-02. Rate limiting is per project, and failed-auth floods do not starve valid keys', () => {
  let s;
  before(async () => { s = await startServer(); });
  after(async () => s.kill());
  it('[S-02] 40 bad-key requests (spoofed XFF) do not cause a valid key to receive 429', async () => {
    const p = await s.project('t-dos'); 
    for (let i = 0; i < 40; i++) await s.req('POST', '/api/v1/otp/send', { headers: { 'X-Api-Key': 'attacker' + i, 'X-Forwarded-For': `198.51.100.${i}` }, body: { phone: '919000000099' } });
    const legit = await s.req('POST', '/api/v1/otp/send', { headers: { 'X-Api-Key': p.api_key }, body: { phone: '919000000098' } });
    assert.equal(legit.status, 200, 'legit OTP send got ' + legit.status);
  });
});

/* ───────────────────────────── O. OTP service ───────────────────────────── */
describe('O. OTP service', () => {
  let s, h;
  before(async () => { s = await startServer(); const p = await s.project('t-otp'); h = { 'X-Api-Key': p.api_key }; });
  after(async () => s.kill());
  const send = (phone, extra = {}) => s.req('POST', '/api/v1/otp/send', { headers: h, body: { phone, ...extra } });
  const verify = (phone, c) => s.req('POST', '/api/v1/otp/verify', { headers: h, body: { phone, code: c } });

  it('[R-09a] burning all 3 attempts does not reset the resend cooldown', async () => {
    assert.equal((await send('919000000001')).status, 200);
    for (const c of ['000000', '000001', '000002']) await verify('919000000001', c);
    assert.equal((await send('919000000001')).status, 429);
  });
  it('[R-09b] a successful verification does not allow an instant re-send', async () => {
    await s.ctl('/reset');
    assert.equal((await send('919000000005')).status, 200);
    const c = code((await s.sentTexts()).pop().text);
    assert.equal((await verify('919000000005', c)).json.verified, true);
    assert.equal((await send('919000000005')).status, 429);
  });
  it('[R-08] two simultaneous send requests deliver exactly ONE WhatsApp message', async () => {
    await s.ctl('/reset'); await s.ctl('/set?latencyMs=400');
    const [a, b] = await Promise.all([send('919000000002'), send('919000000002')]);
    await s.ctl('/set?latencyMs=0');
    const delivered = (await s.sentTexts()).filter((x) => x.jid.startsWith('919000000002')).length;
    assert.equal(delivered, 1, `statuses ${a.status}/${b.status}, delivered ${delivered}`);
  });
  it('[R-09c] a per-number hourly cap stops WhatsApp spam to one victim', async () => {
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      const db = openDb(s.dataDir); db.prepare(`UPDATE otps SET created_at = datetime('now','-2 minutes') WHERE phone = '919000000007'`).run(); db.close();
      const r = await send('919000000007'); if (r.status === 429) limited = true;
    }
    assert.ok(limited, 'never rate-limited across 12 sends');
  });
  it('[R-10] expired OTP rows are purged on schedule (mixed date formats handled)', async () => {
    const dir = s.dataDir; await s.kill();
    const db = openDb(dir); const p = db.prepare(`SELECT id FROM projects LIMIT 1`).get();
    const exp = new Date(Date.now() - 24.5 * 3600 * 1000).toISOString();
    db.prepare(`INSERT INTO otps (project_id, phone, code_hash, attempts_left, expires_at) VALUES (?, '919000000077', 'aa', 0, ?)`).run(p.id, exp); db.close();
    s = await startServer({ dataDir: dir });
    const db2 = openDb(dir); const left = db2.prepare(`SELECT COUNT(*) c FROM otps WHERE phone='919000000077'`).get().c; db2.close();
    assert.equal(left, 0);
  });
});

/* ───────────────────────────── R. Queue & connection reliability ───────────────────────────── */
describe('R. Queue & connection reliability', () => {
  it('[R-02] a reconnect while a message is mid-send does not deliver it twice', async () => {
    const s = await startServer(); try {
      const p = await s.project('t-dup'); await s.ctl('/set?latencyMs=1500');
      await s.req('POST', '/api/v1/messages', { headers: { 'X-Api-Key': p.api_key }, body: { message: 'PAYMENT #A1', recipient: '+919000000003' } });
      await sleep(300); await s.ctl('/reopen'); await sleep(4500);
      const n = (await s.sentTexts()).filter((x) => x.text === 'PAYMENT #A1').length; assert.equal(n, 1, 'delivered ' + n + 'x');
    } finally { await s.kill(); }
  });
  it('[R-03] a DB error inside the queue drain does not crash the process', async () => {
    const s = await startServer(); try {
      const p = await s.project('t-dberr'); const db = openDb(s.dataDir);
      db.exec(`CREATE TRIGGER blk BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT,'simulated disk I/O error'); END;`);
      await s.req('POST', '/api/v1/messages', { headers: { 'X-Api-Key': p.api_key }, body: { message: 'ping', recipient: '+919000000011' } });
      await sleep(1500); assert.equal(await s.alive(), true, 'process died: ' + s.log.slice(-200)); db.close();
    } finally { await s.kill(); }
  });
  it('[R-04] an error on the reconnect path does not crash the process and recovers', async () => {
    const s = await startServer(); try {
      await s.ctl('/set?authFail=1'); await s.ctl('/close?code=428'); await sleep(2500);
      assert.equal(await s.alive(), true, 'process died');
      await s.ctl('/set?authFail=0'); await sleep(4500);
      assert.equal((await s.req('GET', '/api/v1/status')).json.whatsapp, 'connected', 'did not recover');
    } finally { await s.kill(); }
  });
  it('[R-01] REDACT_BODIES: after a crash, recovered messages are NEVER sent as the literal "[redacted]"', async () => {
    let s = await startServer({ env: { REDACT_BODIES: 'true' } }); const dir = s.dataDir;
    const p = await s.project('t-redact'); await s.ctl('/set?latencyMs=3000');
    for (const n of [1, 2, 3]) await s.req('POST', '/api/v1/messages', { headers: { 'X-Api-Key': p.api_key }, body: { message: `Your order #${n} shipped`, recipient: '+919000000010' } });
    await sleep(400); await s.kill();
    s = await startServer({ env: { REDACT_BODIES: 'true' }, dataDir: dir }); await sleep(2500);
    try { const texts = (await s.sentTexts()).map((x) => x.text); assert.ok(!texts.includes('[redacted]'), 'delivered: ' + JSON.stringify(texts)); } finally { await s.kill(); }
  });
  it('[R-11] pairing while a registered session is only reconnecting returns 409 (not a 500)', async () => {
    const s = await startServer(); try {
      await s.ctl('/close?code=428');
      const r = await s.admin('POST', '/admin/pair', { phone_number: '919876543210' });
      assert.equal(r.status, 409, 'got ' + r.status + ' ' + JSON.stringify(r.json));
    } finally { await s.kill(); }
  });
  it('[R-05] SIGTERM shuts down gracefully (exit code 0)', async () => {
    const s = await startServer();
    if (process.platform === 'win32') {
      await s.ctl('/sigterm');
    } else {
      process.kill(s.child.pid, 'SIGTERM');
    }
    const r = await Promise.race([s.exited, sleep(8000).then(() => ({ code: 'timeout' }))]); await s.kill();
    assert.equal(r.code, 0, 'exit: ' + JSON.stringify(r));
  });
});
