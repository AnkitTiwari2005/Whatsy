"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.otpRouter = void 0;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const auth_1 = require("./middleware/auth");
const db_1 = require("../db");
const client_1 = require("../whatsapp/client");
const config_1 = require("../config");
const logger_1 = require("../logger");
exports.otpRouter = (0, express_1.Router)();
// ── Cryptographic Helpers ───────────────────────────────────────────────────
/** One-way HMAC-SHA256 hash using the dedicated persistent OTP secret */
function hashCode(code) {
    return crypto_1.default.createHmac('sha256', config_1.config.otpSecret).update(code.trim()).digest('hex');
}
/** Constant-time verification to prevent timing attacks */
function verifyCode(submittedCode, storedHash) {
    try {
        const submittedHash = hashCode(submittedCode);
        const bufA = Buffer.from(submittedHash, 'hex');
        const bufB = Buffer.from(storedHash, 'hex');
        if (bufA.length !== bufB.length)
            return false;
        return crypto_1.default.timingSafeEqual(bufA, bufB);
    }
    catch {
        return false;
    }
}
// ── POST /api/v1/otp/send ───────────────────────────────────────────────────
exports.otpRouter.post('/send', auth_1.apiKeyAuth, async (req, res) => {
    const { phone, expiry_minutes, digits, message_template } = req.body;
    const project = req.project;
    // 1. Strict Phone Validation
    if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
        res.status(400).json({ error: 'phone is required and must be a valid E.164 phone number' });
        return;
    }
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 7 || cleanPhone.length > 15) {
        res.status(400).json({ error: 'phone must be a valid phone number (7 to 15 digits)' });
        return;
    }
    // 2. Strict Integer Validation
    const rawDigits = digits !== undefined ? Number(digits) : 6;
    if (!Number.isInteger(rawDigits) || rawDigits < 4 || rawDigits > 8) {
        res.status(400).json({ error: 'digits must be an integer between 4 and 8' });
        return;
    }
    const codeDigits = rawDigits;
    const rawExpiry = expiry_minutes !== undefined ? Number(expiry_minutes) : 5;
    if (!Number.isInteger(rawExpiry) || rawExpiry < 1 || rawExpiry > 30) {
        res.status(400).json({ error: 'expiry_minutes must be an integer between 1 and 30' });
        return;
    }
    const expiryMinutes = rawExpiry;
    // 3. Strict Template Validation
    if (message_template !== undefined) {
        if (typeof message_template !== 'string' || !message_template.includes('{code}')) {
            res.status(400).json({ error: 'message_template must be a string containing the {code} placeholder' });
            return;
        }
        if (message_template.length > 250) {
            res.status(400).json({ error: 'message_template must not exceed 250 characters' });
            return;
        }
    }
    const defaultTemplate = 'Your verification code is: *{code}*. Valid for {minutes} minutes. Please do not share this code with anyone.';
    const template = message_template && typeof message_template === 'string' && message_template.includes('{code}')
        ? message_template
        : defaultTemplate;
    // 4. Verify WhatsApp Gateway Readiness Before Touching Database
    const { status, is_ready } = (0, client_1.getStatus)();
    if (status !== 'connected' || !is_ready) {
        res.status(503).json({
            success: false,
            error: 'WhatsApp gateway is currently disconnected or unavailable. Verification code cannot be dispatched.',
            whatsapp_status: status,
        });
        return;
    }
    const db = (0, db_1.getDb)();
    // 5. Rate Limiting: 60-second cooldown per phone number for this project
    // Only applies to currently active, unexpired OTPs with remaining attempts
    const lastOtp = db.prepare(`SELECT id, created_at,
            (strftime('%s', 'now') - strftime('%s', created_at)) as elapsed_seconds
     FROM otps
     WHERE project_id = ? AND phone = ? AND verified = 0 AND attempts_left > 0 AND datetime('now') < expires_at
     ORDER BY id DESC LIMIT 1`).get(project.id, cleanPhone);
    if (lastOtp && lastOtp.elapsed_seconds !== null && lastOtp.elapsed_seconds < 60) {
        const waitSeconds = Math.max(1, 60 - Math.floor(lastOtp.elapsed_seconds));
        res.status(429).json({
            error: `Please wait ${waitSeconds} seconds before requesting another verification code.`,
            retry_after_seconds: waitSeconds,
        });
        return;
    }
    // 6. Generate Cryptographically Secure Numeric OTP
    const minVal = Math.pow(10, codeDigits - 1);
    const maxVal = Math.pow(10, codeDigits) - 1;
    const code = crypto_1.default.randomInt(minVal, maxVal + 1).toString();
    const codeHash = hashCode(code);
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();
    // Format real outbound WhatsApp message
    const body = template
        .replaceAll('{code}', code)
        .replaceAll('{minutes}', String(expiryMinutes));
    // Redact code in audit DB to ensure plaintext OTP is NEVER saved in messages or returned via /admin/messages
    const loggedBody = template
        .replaceAll('{code}', '******')
        .replaceAll('{minutes}', String(expiryMinutes));
    const formattedPhone = phone.startsWith('+') ? phone : `+${cleanPhone}`;
    // 7. Synchronous Direct Dispatch Over WhatsApp WebSocket
    // Bypasses the 2-5s jitter queue. If dispatch throws, previous valid OTP is NOT killed!
    let waId = null;
    try {
        waId = await (0, client_1.sendDirectMessage)((0, client_1.toJid)(cleanPhone), body);
    }
    catch (sendErr) {
        const errMessage = sendErr instanceof Error ? sendErr.message : String(sendErr);
        logger_1.logger.error({ projectId: project.id, phone: cleanPhone, error: errMessage }, 'Failed to deliver OTP via WhatsApp');
        res.status(502).json({
            success: false,
            error: `Failed to deliver OTP via WhatsApp: ${errMessage}. Please try again.`,
        });
        return;
    }
    // 8. Atomic Database Update (Only After Successful WhatsApp Delivery)
    const runTransaction = db.transaction(() => {
        // Invalidate previous unverified OTPs for this phone number
        db.prepare(`UPDATE otps SET attempts_left = 0 WHERE project_id = ? AND phone = ? AND verified = 0`).run(project.id, cleanPhone);
        // Insert new OTP record with salted HMAC hash
        const otpInsert = db.prepare(`INSERT INTO otps (project_id, phone, code_hash, attempts_left, expires_at)
       VALUES (?, ?, ?, 3, ?)`).run(project.id, cleanPhone, codeHash, expiresAt);
        // Insert audit log row with REDACTED body and status='sent'
        const msgInsert = db.prepare(`INSERT INTO messages (project_id, recipient, body, status, wa_message_id, sent_at)
       VALUES (?, ?, ?, 'sent', ?, datetime('now'))`).run(project.id, formattedPhone, loggedBody, waId);
        return {
            requestId: otpInsert.lastInsertRowid,
            messageId: msgInsert.lastInsertRowid,
        };
    });
    const { requestId, messageId } = runTransaction();
    logger_1.logger.info({ requestId, messageId, project: project.name, phone: cleanPhone, waId, expiryMinutes }, 'OTP delivered successfully via WhatsApp');
    res.status(200).json({
        success: true,
        message: 'OTP delivered successfully via WhatsApp',
        phone: formattedPhone,
        expires_in_seconds: expiryMinutes * 60,
        request_id: requestId,
    });
});
// ── POST /api/v1/otp/verify ─────────────────────────────────────────────────
exports.otpRouter.post('/verify', auth_1.apiKeyAuth, async (req, res) => {
    const { phone, code } = req.body;
    const project = req.project;
    if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
        res.status(400).json({ verified: false, error: 'phone is required' });
        return;
    }
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
        res.status(400).json({ verified: false, error: 'code is required' });
        return;
    }
    const cleanPhone = phone.replace(/\D/g, '');
    const cleanCode = code.trim();
    const db = (0, db_1.getDb)();
    // Find the latest active OTP for this project and phone
    const otpRecord = db.prepare(`SELECT id, code_hash, attempts_left, verified, expires_at
     FROM otps
     WHERE project_id = ? AND phone = ?
     ORDER BY id DESC LIMIT 1`).get(project.id, cleanPhone);
    if (!otpRecord) {
        logger_1.logger.warn({ projectId: project.id, phone: cleanPhone }, 'Verification failed: no OTP found');
        res.status(404).json({
            verified: false,
            error: 'No active OTP verification code found for this phone number. Please request a new code.',
        });
        return;
    }
    if (otpRecord.verified === 1) {
        logger_1.logger.warn({ projectId: project.id, phone: cleanPhone, otpId: otpRecord.id }, 'Verification failed: already verified');
        res.status(400).json({
            verified: false,
            error: 'This verification code has already been verified and cannot be reused.',
        });
        return;
    }
    if (otpRecord.attempts_left <= 0) {
        logger_1.logger.warn({ projectId: project.id, phone: cleanPhone, otpId: otpRecord.id }, 'Verification failed: locked');
        res.status(403).json({
            verified: false,
            attempts_left: 0,
            error: 'This verification code is locked due to too many failed attempts. Please request a new code.',
        });
        return;
    }
    const expiresTime = new Date(otpRecord.expires_at).getTime();
    if (Date.now() > expiresTime) {
        logger_1.logger.warn({ projectId: project.id, phone: cleanPhone, otpId: otpRecord.id }, 'Verification failed: expired');
        res.status(410).json({
            verified: false,
            error: 'This verification code has expired. Please request a new code.',
        });
        return;
    }
    // Constant-time equality comparison
    const isMatch = verifyCode(cleanCode, otpRecord.code_hash);
    if (isMatch) {
        // Mark as verified and burn remaining attempts to prevent reuse
        db.prepare(`UPDATE otps SET verified = 1, attempts_left = 0 WHERE id = ?`).run(otpRecord.id);
        logger_1.logger.info({ projectId: project.id, phone: cleanPhone, otpId: otpRecord.id }, 'OTP verified successfully via timing-safe check');
        res.status(200).json({
            verified: true,
            message: 'Code verified successfully',
            phone: phone.startsWith('+') ? phone : `+${cleanPhone}`,
        });
    }
    else {
        const remaining = otpRecord.attempts_left - 1;
        db.prepare(`UPDATE otps SET attempts_left = ? WHERE id = ?`).run(remaining, otpRecord.id);
        logger_1.logger.warn({ projectId: project.id, phone: cleanPhone, otpId: otpRecord.id, remainingAttempts: remaining }, 'OTP verification code mismatch');
        if (remaining <= 0) {
            res.status(403).json({
                verified: false,
                attempts_left: 0,
                error: 'Incorrect code. Maximum verification attempts exceeded. Code is now permanently locked.',
            });
        }
        else {
            res.status(400).json({
                verified: false,
                attempts_left: remaining,
                error: `Incorrect verification code. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining.`,
            });
        }
    }
});
//# sourceMappingURL=otp.js.map