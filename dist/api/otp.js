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
/** One-way HMAC-SHA256 hash using the server secret key as salt */
function hashCode(code) {
    return crypto_1.default.createHmac('sha256', config_1.config.adminKey).update(code.trim()).digest('hex');
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
    if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
        res.status(400).json({ error: 'phone is required and must be a valid E.164 phone number' });
        return;
    }
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 7 || cleanPhone.length > 15) {
        res.status(400).json({ error: 'phone must be a valid phone number (7 to 15 digits)' });
        return;
    }
    const expiryMinutes = Math.min(Math.max(Number(expiry_minutes) || 5, 1), 30);
    const codeDigits = Math.min(Math.max(Number(digits) || 6, 4), 8);
    const defaultTemplate = 'Your verification code is: *{code}*. Valid for {minutes} minutes. Please do not share this code with anyone.';
    const template = message_template && typeof message_template === 'string' && message_template.includes('{code}')
        ? message_template
        : defaultTemplate;
    const db = (0, db_1.getDb)();
    // Rate Limiting: 60-second cooldown per phone number for this project
    const lastOtp = db.prepare(`SELECT id, created_at,
            (strftime('%s', 'now') - strftime('%s', created_at)) as elapsed_seconds
     FROM otps
     WHERE project_id = ? AND phone = ? AND verified = 0
     ORDER BY id DESC LIMIT 1`).get(project.id, cleanPhone);
    if (lastOtp && lastOtp.elapsed_seconds !== null && lastOtp.elapsed_seconds < 60) {
        const waitSeconds = Math.max(1, 60 - Math.floor(lastOtp.elapsed_seconds));
        res.status(429).json({
            error: `Please wait ${waitSeconds} seconds before requesting another verification code.`,
            retry_after_seconds: waitSeconds,
        });
        return;
    }
    // Invalidate any existing active unverified OTPs for this phone number
    db.prepare(`UPDATE otps SET attempts_left = 0 WHERE project_id = ? AND phone = ? AND verified = 0`).run(project.id, cleanPhone);
    // Generate cryptographically secure numeric OTP
    const minVal = Math.pow(10, codeDigits - 1);
    const maxVal = Math.pow(10, codeDigits) - 1;
    const code = crypto_1.default.randomInt(minVal, maxVal + 1).toString();
    const codeHash = hashCode(code);
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();
    // Insert into SQLite otps table
    const otpResult = db.prepare(`INSERT INTO otps (project_id, phone, code_hash, attempts_left, expires_at)
     VALUES (?, ?, ?, 3, ?)`).run(project.id, cleanPhone, codeHash, expiresAt);
    const requestId = otpResult.lastInsertRowid;
    // Format message text
    const body = template
        .replace('{code}', code)
        .replace('{minutes}', String(expiryMinutes));
    const formattedPhone = phone.startsWith('+') ? phone : `+${cleanPhone}`;
    const loggedBody = config_1.config.redactBodies ? '[OTP redacted]' : body;
    // Insert message row for audit tracking
    const msgResult = db.prepare(`INSERT INTO messages (project_id, recipient, body, status)
     VALUES (?, ?, ?, 'queued')`).run(project.id, formattedPhone, loggedBody);
    const messageId = msgResult.lastInsertRowid;
    const { status } = (0, client_1.getStatus)();
    if (status === 'disconnected') {
        logger_1.logger.warn({ projectId: project.id, phone: cleanPhone }, 'Queuing OTP message while WhatsApp disconnected');
    }
    try {
        // Priority dispatch: unshift to front of queue
        (0, client_1.enqueueMessage)({
            messageId,
            recipient: (0, client_1.toJid)(cleanPhone),
            body,
        }, true // priority = true
        );
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        db.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).run(error, messageId);
        res.status(503).json({ error: `Failed to queue OTP dispatch: ${error}` });
        return;
    }
    logger_1.logger.info({ requestId, messageId, project: project.name, phone: cleanPhone, expiryMinutes }, 'OTP generated and queued with priority');
    res.status(200).json({
        success: true,
        message: 'OTP sent successfully via WhatsApp',
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
    // Find latest OTP record for this project and phone
    const otpRecord = db.prepare(`SELECT id, project_id, phone, code_hash, attempts_left, verified, expires_at, created_at
     FROM otps
     WHERE project_id = ? AND phone = ?
     ORDER BY id DESC LIMIT 1`).get(project.id, cleanPhone);
    if (!otpRecord) {
        res.status(400).json({
            verified: false,
            error: 'No verification request found for this phone number',
        });
        return;
    }
    if (otpRecord.verified === 1) {
        res.status(400).json({
            verified: false,
            error: 'This verification code has already been used',
        });
        return;
    }
    if (otpRecord.attempts_left <= 0) {
        res.status(400).json({
            verified: false,
            error: 'Too many failed attempts. This code is locked. Please request a new code.',
            attempts_left: 0,
        });
        return;
    }
    const expiresTime = new Date(otpRecord.expires_at).getTime();
    if (Date.now() > expiresTime) {
        res.status(400).json({
            verified: false,
            error: 'Verification code has expired. Please request a new code.',
        });
        return;
    }
    // Constant-time comparison
    const isMatch = verifyCode(cleanCode, otpRecord.code_hash);
    if (isMatch) {
        // Mark verified and close attempts
        db.prepare(`UPDATE otps SET verified = 1, attempts_left = 0 WHERE id = ?`).run(otpRecord.id);
        logger_1.logger.info({ projectId: project.id, phone: cleanPhone, otpId: otpRecord.id }, 'OTP verified successfully');
        res.status(200).json({
            verified: true,
            message: 'Phone number verified successfully',
            phone: phone.startsWith('+') ? phone : `+${cleanPhone}`,
        });
        return;
    }
    else {
        // Decrement attempts
        const remaining = otpRecord.attempts_left - 1;
        db.prepare(`UPDATE otps SET attempts_left = ? WHERE id = ?`).run(Math.max(0, remaining), otpRecord.id);
        logger_1.logger.warn({ projectId: project.id, phone: cleanPhone, attemptsLeft: remaining }, 'Invalid OTP attempt');
        if (remaining <= 0) {
            res.status(400).json({
                verified: false,
                error: 'Incorrect code. Maximum attempts reached. Code is now locked.',
                attempts_left: 0,
            });
        }
        else {
            res.status(400).json({
                verified: false,
                error: 'Incorrect verification code',
                attempts_left: remaining,
            });
        }
        return;
    }
});
//# sourceMappingURL=otp.js.map