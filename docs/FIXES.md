# Audit fixes — where each finding was addressed

Finding IDs match the audit report and the test names in `test/regression.test.js`.

| ID | Fix | Files |
|---|---|---|
| R-01 | `[redacted]` rows are failed with a clear reason instead of being sent after a restart | `whatsapp/client.ts` |
| R-02 | In-flight set prevents re-enqueueing a row that is mid-send | `whatsapp/client.ts` |
| R-03 | Drain loop wrapped in try/finally; DB writes in delivery path are non-throwing | `whatsapp/client.ts` |
| R-04 | Reconnect errors caught and re-scheduled with backoff; single-flight connect; stale sockets ignored | `whatsapp/client.ts` |
| R-05 | SIGTERM/SIGINT graceful shutdown; `unhandledRejection` / `uncaughtException` handlers | `index.ts` |
| R-06 | Sent-message cache so WhatsApp retry requests re-send the real content | `whatsapp/client.ts` |
| R-07 | Transient-failure retry (`SEND_MAX_ATTEMPTS`), `Idempotency-Key`, admin "retry" | `client.ts`, `messages.ts`, `logs.ts` |
| R-08 | Per-number send lock | `otp.ts` |
| R-09 | Cooldown counted from last code regardless of state; hourly cap per number | `otp.ts`, `config.ts` |
| R-10 | `julianday()` comparisons for expiry/purge | `db/index.ts` |
| R-11 | 409 with accurate message; `POST /admin/pair/unlink`; `GET /admin/pair/status` | `pair.ts`, `client.ts` |
| R-12 | Send timeout (`SEND_TIMEOUT_MS`) | `client.ts`, `util/http.ts` |
| S-01 | Admin-key lockout per IP | `middleware/adminAuth.ts` |
| S-02 | Limits applied per project after auth; invalid-key floods cannot block valid keys; `TRUST_PROXY` | `app.ts`, `middleware/auth.ts` |
| S-03 | CORS off by default; opt-in `CORS_ORIGINS` | `app.ts` |
| S-04 | Strict CSP; UI split into CSS/JS files; no inline script, no external fonts | `app.ts`, `admin-ui/*` |
| S-05/06 | SHA-256 key lookup (O(1)); legacy bcrypt keys upgraded on first use | `middleware/auth.ts`, `projects.ts` |
| S-08 | Admin key in `sessionStorage` only; API keys never persisted | `admin-ui/admin.js` |
| A-01…A-09 | Body guard, central error handler, strict validation, E.164 normaliser, ISO timestamps, `/health` checks DB | `app.ts`, `util/*`, `api/*` |
| D-01/02 | Versioned migrations, `status` index, optional retention | `db/index.ts` |
| O-01…O-05 | `verify:dist`, bounded env validation, `.env.example`, test suite | `scripts/*`, `config.ts`, `test/*` |
| U-01…U-14 | Admin console rebuilt (responsive, accessible, offline-aware) | `admin-ui/*` |
