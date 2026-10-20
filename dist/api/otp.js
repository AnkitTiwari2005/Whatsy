"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.otpRouter = void 0;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const client_1 = require("../whatsapp/client");
const config_1 = require("../config");
const logger_1 = require("../logger");
const http_1 = require("../util/http");
const phone_1 = require("../util/phone");
exports.otpRouter = (0, express_1.Router)();
const hashCode = (code) => crypto_1.default.createHmac('sha256', config_1.config.otpSecret).update(code.trim()).digest('hex');
function verifyCode(submitted, storedHash) {
    try {
        const a = Buffer.from(hashCode(submitted), 'hex');
        const b = Buffer.from(storedHash, 'hex');
        return a.length === b.length && crypto_1.default.timingSafeEqual(a, b);
    }
    catch {
        return false;
    }
}
/** project:phone pairs with a send in progress — closes the check-then-send race that produced two codes. */
const sending = new Set();
function tooMany(res, seconds, msg) {
    res.set('Retry-After', String(seconds));
    res.status(429).json({ error: msg, code: 'otp_rate_limited', retry_after_seconds: seconds });
}
// POST /api/v1/otp/send
exports.otpRouter.post('/send', async (req, res) => {
    const { phone, phone_number, recipient, expiry_minutes, digits, message_template } = req.body;
    const project = req.project;
    const rawPhone = phone ?? phone_number ?? recipient;
    const p = (0, phone_1.normalizePhone)(rawPhone);
    if (!p.ok)
        throw new http_1.HttpError(400, 'invalid_phone', `phone ${p.error}`);
    const codeDigits = digits !== undefined ? Number(digits) : 6;
    if (!Number.isInteger(codeDigits) || codeDigits < 4 || codeDigits > 8)
        throw new http_1.HttpError(400, 'invalid_digits', 'digits must be an integer between 4 and 8');
    const expiryMinutes = expiry_minutes !== undefined ? Number(expiry_minutes) : 5;
    if (!Number.isInteger(expiryMinutes) || expiryMinutes < 1 || expiryMinutes > 30)
        throw new http_1.HttpError(400, 'invalid_expiry', 'expiry_minutes must be an integer between 1 and 30');
    let template = 'Your verification code is: *{code}*. Valid for {minutes} minutes. Please do not share this code with anyone.';
    if (message_template !== undefined) {
        if (typeof message_template !== 'string' || !message_template.includes('{code}'))
            throw new http_1.HttpError(400, 'invalid_template', 'message_template must be a string containing the {code} placeholder');
        if (message_template.length > 250)
            throw new http_1.HttpError(400, 'invalid_template', 'message_template must not exceed 250 characters');
        template = message_template;
    }
    const wa = (0, client_1.getStatus)();
    if (wa.status !== 'connected' || !wa.is_ready) {
        res.status(503).json({ success: false, error: 'WhatsApp gateway is currently disconnected or unavailable. Verification code cannot be dispatched.', code: 'whatsapp_unavailable', whatsapp_status: wa.status });
        return;
    }
    const db = (0, db_1.getDb)();
    const lockKey = `${project.id}:${p.digits}`;
    if (sending.has(lockKey)) {
        tooMany(res, 2, 'A verification code for this number is already being sent.');
        return;
    }
    sending.add(lockKey);
    try {
        // Cooldown counts from the LAST code regardless of its state (verified / locked / expired) — burning attempts cannot reset it.
        const last = db.prepare(`SELECT (strftime('%s','now') - strftime('%s', created_at)) AS elapsed FROM otps WHERE project_id = ? AND phone = ? ORDER BY id DESC LIMIT 1`).get(project.id, p.digits);
        if (last && config_1.config.otpCooldownSeconds > 0 && last.elapsed < config_1.config.otpCooldownSeconds) {
            const wait = Math.max(1, config_1.config.otpCooldownSeconds - last.elapsed);
            tooMany(res, wait, `Please wait ${wait} seconds before requesting another verification code.`);
            return;
        }
        // Hard cap per number per hour so an attacker cannot turn the gateway into a WhatsApp spam cannon.
        const win = db.prepare(`SELECT COUNT(*) AS n, MIN(strftime('%s', created_at)) AS oldest FROM otps WHERE project_id = ? AND phone = ? AND created_at > datetime('now','-1 hour')`).get(project.id, p.digits);
        if (win.n >= config_1.config.otpMaxPerHour) {
            const wait = Math.max(1, Number(win.oldest) + 3600 - Math.floor(Date.now() / 1000));
            tooMany(res, wait, `Too many verification codes requested for this number. Try again in ${Math.ceil(wait / 60)} minute(s).`);
            return;
        }
        const code = crypto_1.default.randomInt(Math.pow(10, codeDigits - 1), Math.pow(10, codeDigits)).toString();
        const body = template.replaceAll('{code}', code).replaceAll('{minutes}', String(expiryMinutes));
        const loggedBody = template.replaceAll('{code}', '******').replaceAll('{minutes}', String(expiryMinutes));
        const expiresAt = new Date(Date.now() + expiryMinutes * 60_000).toISOString();
        let waId;
        try {
            waId = await (0, client_1.sendDirectMessage)((0, client_1.toJid)(p.digits), body);
        }
        catch (sendErr) {
            const m = sendErr instanceof Error ? sendErr.message : String(sendErr);
            logger_1.logger.error({ projectId: project.id, error: m }, 'Failed to deliver OTP via WhatsApp');
            res.status(502).json({ success: false, error: `Failed to deliver OTP via WhatsApp: ${m}. Please try again.`, code: 'delivery_failed' });
            return;
        }
        const { requestId } = db.transaction(() => {
            db.prepare(`UPDATE otps SET attempts_left = 0 WHERE project_id = ? AND phone = ? AND verified = 0`).run(project.id, p.digits);
            const o = db.prepare(`INSERT INTO otps (project_id, phone, code_hash, attempts_left, expires_at) VALUES (?, ?, ?, 3, ?)`).run(project.id, p.digits, hashCode(code), expiresAt);
            db.prepare(`INSERT INTO messages (project_id, recipient, body, status, wa_message_id, sent_at) VALUES (?, ?, ?, 'sent', ?, datetime('now'))`).run(project.id, p.e164, loggedBody, waId);
            return { requestId: o.lastInsertRowid };
        })();
        logger_1.logger.info({ requestId, project: project.name }, 'OTP delivered');
        res.status(200).json({ success: true, message: 'OTP delivered successfully via WhatsApp', phone: p.e164, expires_in_seconds: expiryMinutes * 60, request_id: requestId });
    }
    finally {
        sending.delete(lockKey);
    }
});
// POST /api/v1/otp/verify
exports.otpRouter.post('/verify', (req, res) => {
    const { phone, phone_number, recipient, code } = req.body;
    const project = req.project;
    const fail = (status, codeName, error, extra = {}) => { res.status(status).json({ success: false, verified: false, error, code: codeName, ...extra }); };
    const rawPhone = phone ?? phone_number ?? recipient;
    const p = (0, phone_1.normalizePhone)(rawPhone);
    if (!p.ok)
        return fail(400, 'invalid_phone', `phone ${p.error}`);
    const submitted = typeof code === 'number' ? String(code) : typeof code === 'string' ? code.trim() : '';
    if (!/^\d{4,8}$/.test(submitted))
        return fail(400, 'invalid_code_format', 'code must be 4 to 8 digits'); // malformed input does not burn an attempt
    const db = (0, db_1.getDb)();
    const rec = db.prepare(`SELECT id, code_hash, attempts_left, verified, expires_at FROM otps WHERE project_id = ? AND phone = ? ORDER BY id DESC LIMIT 1`).get(project.id, p.digits);
    if (!rec)
        return fail(404, 'not_found', 'No active OTP verification code found for this phone number. Please request a new code.');
    if (rec.verified === 1)
        return fail(400, 'already_verified', 'This verification code has already been verified and cannot be reused.');
    if (rec.attempts_left <= 0)
        return fail(403, 'locked', 'This verification code is locked due to too many failed attempts. Please request a new code.', { attempts_left: 0 });
    if (Date.now() > new Date(rec.expires_at).getTime())
        return fail(410, 'expired', 'This verification code has expired. Please request a new code.');
    if (verifyCode(submitted, rec.code_hash)) {
        db.prepare(`UPDATE otps SET verified = 1, attempts_left = 0 WHERE id = ?`).run(rec.id);
        res.status(200).json({ success: true, verified: true, message: 'Code verified successfully', phone: p.e164 });
        return;
    }
    const remaining = rec.attempts_left - 1;
    db.prepare(`UPDATE otps SET attempts_left = ? WHERE id = ?`).run(remaining, rec.id);
    logger_1.logger.warn({ otpId: rec.id, remaining }, 'OTP mismatch');
    if (remaining <= 0)
        return fail(403, 'locked', 'Incorrect code. Maximum verification attempts exceeded. Code is now permanently locked.', { attempts_left: 0 });
    fail(400, 'incorrect_code', `Incorrect verification code. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining.`, { attempts_left: remaining });
});
//# sourceMappingURL=otp.js.map