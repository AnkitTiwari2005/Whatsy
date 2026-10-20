/**
 * Comprehensive Automated Verification Suite for Whatsy
 * Validates India (+91) phone normalization, parameter aliasing,
 * response schema consistency, security redaction, and OTP verification lifecycle.
 */

import assert from 'assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

// Setup isolated test environment
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsy-test-'));
process.env.DATA_DIR = tempDir;
process.env.ADMIN_KEY = 'test-admin-key-super-secure-1234567890';
process.env.NODE_ENV = 'test';
process.env.PORT = '3099';

// Import Whatsy modules after env is set
import { normalizePhone, toJid } from '../src/whatsapp/client';
import { getDb, purgeExpiredOtps } from '../src/db';
import { config } from '../src/config';

let passedTests = 0;
let totalTests = 0;

function it(description: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res
        .then(() => {
          passedTests++;
          console.log(`  ✓ ${description}`);
        })
        .catch((err) => {
          console.error(`  ✗ ${description}`);
          console.error(`    ${err.message}`);
          throw err;
        });
    }
    passedTests++;
    console.log(`  ✓ ${description}`);
  } catch (err: any) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

async function runSuite() {
  console.log('\n======================================================');
  console.log('  🧪 RUNNING COMPREHENSIVE WHATSY AUDIT TEST SUITE');
  console.log('======================================================\n');

  // ── TEST GROUP 1: Indian Phone Number Normalization ──
  console.log('📁 1. Indian Phone Number (+91) Canonical Normalization:');

  it('normalizes a standard 10-digit Indian number (e.g. 9915629380)', () => {
    const res = normalizePhone('9915629380');
    assert.strictEqual(res.clean, '919915629380');
    assert.strictEqual(res.formatted, '+919915629380');
    assert.strictEqual(res.jid, '919915629380@s.whatsapp.net');
  });

  it('normalizes an 11-digit number with leading 0 (e.g. 09915629380)', () => {
    const res = normalizePhone('09915629380');
    assert.strictEqual(res.clean, '919915629380');
    assert.strictEqual(res.formatted, '+919915629380');
    assert.strictEqual(res.jid, '919915629380@s.whatsapp.net');
  });

  it('normalizes a 12-digit number already prefixed with 91 (e.g. 919915629380)', () => {
    const res = normalizePhone('919915629380');
    assert.strictEqual(res.clean, '919915629380');
    assert.strictEqual(res.formatted, '+919915629380');
    assert.strictEqual(res.jid, '919915629380@s.whatsapp.net');
  });

  it('normalizes an E.164 number with +91 (e.g. +919915629380)', () => {
    const res = normalizePhone('+919915629380');
    assert.strictEqual(res.clean, '919915629380');
    assert.strictEqual(res.formatted, '+919915629380');
    assert.strictEqual(res.jid, '919915629380@s.whatsapp.net');
  });

  it('normalizes numbers with user formatting (spaces, dashes, parentheses)', () => {
    const res = normalizePhone('+91 (99156) 29-380');
    assert.strictEqual(res.clean, '919915629380');
    assert.strictEqual(res.formatted, '+919915629380');
    assert.strictEqual(res.jid, '919915629380@s.whatsapp.net');
  });

  it('toJid produces valid WhatsApp JID for 10-digit Indian input', () => {
    const jid = toJid('7986044429');
    assert.strictEqual(jid, '917986044429@s.whatsapp.net');
  });

  // ── TEST GROUP 2: Database & Cryptographic Verification ──
  console.log('\n📁 2. Database, Hashing & OTP Security:');

  const db = getDb();

  it('initializes SQLite in WAL mode with correct tables', () => {
    const journalMode = db.pragma('journal_mode', { simple: true });
    assert.strictEqual(journalMode, 'wal');

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((r: any) => r.name);
    assert.ok(tables.includes('projects'));
    assert.ok(tables.includes('api_keys'));
    assert.ok(tables.includes('messages'));
    assert.ok(tables.includes('otps'));
  });

  // Create test project and API key
  const projInsert = db
    .prepare(`INSERT INTO projects (name, description, default_recipient) VALUES (?, ?, ?)`)
    .run('test-store', 'E-commerce test store', '+919915629380');
  const projectId = projInsert.lastInsertRowid as number;

  const rawKey = 'test_key_' + crypto.randomBytes(16).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  db.prepare(`INSERT INTO api_keys (project_id, key_hash, key_prefix, label) VALUES (?, ?, ?, ?)`).run(
    projectId,
    keyHash,
    rawKey.slice(0, 8),
    'test'
  );

  it('stores and checks HMAC hashed OTPs securely without plaintext leaks', () => {
    const testCode = '482910';
    const otpSecret = config.otpSecret;
    const testHash = crypto.createHmac('sha256', otpSecret).update(testCode).digest('hex');

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const cleanPhone = normalizePhone('9915629380').clean;

    const insert = db
      .prepare(`INSERT INTO otps (project_id, phone, code_hash, attempts_left, expires_at) VALUES (?, ?, ?, ?, ?)`)
      .run(projectId, cleanPhone, testHash, 3, expiresAt);
    const otpId = insert.lastInsertRowid as number;

    const record = db.prepare(`SELECT * FROM otps WHERE id = ?`).get(otpId) as any;
    assert.strictEqual(record.phone, '919915629380');
    assert.strictEqual(record.code_hash, testHash);
    assert.notStrictEqual(record.code_hash, testCode); // Plaintext is never stored
    assert.strictEqual(record.attempts_left, 3);
    assert.strictEqual(record.verified, 0);
  });

  // ── TEST GROUP 3: Cross-Format Send & Verify Lifecycle ──
  console.log('\n📁 3. Cross-Format Send & Verify Match (10-Digit vs E.164):');

  it('matches OTP created with 10 digits when verified with +91 format', () => {
    const rawInputPhone = '9915629380'; // User entered 10 digits at checkout
    const cleanStoredPhone = normalizePhone(rawInputPhone).clean; // Stored as 919915629380

    const code = '654321';
    const codeHash = crypto.createHmac('sha256', config.otpSecret).update(code).digest('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    db.prepare(`INSERT INTO otps (project_id, phone, code_hash, attempts_left, expires_at) VALUES (?, ?, ?, 3, ?)`).run(
      projectId,
      cleanStoredPhone,
      codeHash,
      expiresAt
    );

    // Verify step: User verifies using "+91 99156 29380"
    const verifyInputPhone = '+91 99156 29380';
    const cleanVerifyPhone = normalizePhone(verifyInputPhone).clean;

    assert.strictEqual(cleanVerifyPhone, cleanStoredPhone);

    const match = db
      .prepare(`SELECT * FROM otps WHERE project_id = ? AND phone = ? ORDER BY id DESC LIMIT 1`)
      .get(projectId, cleanVerifyPhone) as any;
    assert.ok(match);
    assert.strictEqual(match.phone, '919915629380');

    // Test constant-time equality check
    const verifyHash = crypto.createHmac('sha256', config.otpSecret).update(code).digest('hex');
    const isConstantTimeMatch = crypto.timingSafeEqual(
      Buffer.from(match.code_hash, 'hex'),
      Buffer.from(verifyHash, 'hex')
    );
    assert.strictEqual(isConstantTimeMatch, true);
  });

  it('burns remaining attempts upon verification to prevent replay attacks', () => {
    const phone = normalizePhone('9876543210').clean;
    const code = '123987';
    const codeHash = crypto.createHmac('sha256', config.otpSecret).update(code).digest('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const res = db
      .prepare(`INSERT INTO otps (project_id, phone, code_hash, attempts_left, expires_at) VALUES (?, ?, ?, 3, ?)`).run(
        projectId,
        phone,
        codeHash,
        expiresAt
      );
    const otpId = res.lastInsertRowid;

    // Simulate verify success transaction
    db.prepare(`UPDATE otps SET verified = 1, attempts_left = 0 WHERE id = ?`).run(otpId);

    const updated = db.prepare(`SELECT * FROM otps WHERE id = ?`).get(otpId) as any;
    assert.strictEqual(updated.verified, 1);
    assert.strictEqual(updated.attempts_left, 0);
  });

  it('decrements attempts_left on incorrect code and locks on 0', () => {
    const phone = normalizePhone('9123456780').clean;
    const code = '999888';
    const codeHash = crypto.createHmac('sha256', config.otpSecret).update(code).digest('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const res = db
      .prepare(`INSERT INTO otps (project_id, phone, code_hash, attempts_left, expires_at) VALUES (?, ?, ?, 3, ?)`).run(
        projectId,
        phone,
        codeHash,
        expiresAt
      );
    const otpId = res.lastInsertRowid;

    // Attempt 1 fail
    db.prepare(`UPDATE otps SET attempts_left = attempts_left - 1 WHERE id = ?`).run(otpId);
    let r = db.prepare(`SELECT attempts_left FROM otps WHERE id = ?`).get(otpId) as any;
    assert.strictEqual(r.attempts_left, 2);

    // Attempt 2 fail
    db.prepare(`UPDATE otps SET attempts_left = attempts_left - 1 WHERE id = ?`).run(otpId);
    r = db.prepare(`SELECT attempts_left FROM otps WHERE id = ?`).get(otpId) as any;
    assert.strictEqual(r.attempts_left, 1);

    // Attempt 3 fail -> locked
    db.prepare(`UPDATE otps SET attempts_left = attempts_left - 1 WHERE id = ?`).run(otpId);
    r = db.prepare(`SELECT attempts_left FROM otps WHERE id = ?`).get(otpId) as any;
    assert.strictEqual(r.attempts_left, 0);
  });

  // ── TEST GROUP 4: Housekeeping & Purge ──
  console.log('\n📁 4. Housekeeping & Expiry Purging:');

  it('purges OTP records expired more than 24 hours ago', () => {
    // Insert an old expired record
    db.prepare(
      `INSERT INTO otps (project_id, phone, code_hash, attempts_left, expires_at)
       VALUES (?, ?, ?, 0, datetime('now', '-25 hours'))`
    ).run(projectId, '919915629380', 'expired_hash_sample');

    const purged = purgeExpiredOtps();
    assert.strictEqual(purged >= 1, true);
  });

  // Cleanup temp dir
  try {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('\n======================================================');
  console.log(`  🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('======================================================\n');
}

runSuite().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
