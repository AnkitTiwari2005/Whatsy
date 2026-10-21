# Whatsy — second-pass audit

Scope: every file in `src/`, `test/`, `scripts/`, config and docs. `tsc` is clean and the suite is 35/35 (30 existing + 5 new, `[N-01]…[N-05]`).
**Not verified:** behaviour against a live WhatsApp account (tests use a fake Baileys transport), and the redesigned UI was not visually rendered. Please click through it once.

## Fixed

| # | Sev | Area | Problem | Fix |
|---|---|---|---|---|
| 1 | High | Messages API | A request rejected with 503 `queue_full` kept its `Idempotency-Key`. The client's retry then got the old **failed** row back with HTTP 200 and the message was never sent. | Key is released when enqueue fails. |
| 2 | Med | Messages API | Reusing a key with a different recipient/body silently returned the first message. | 409 `idempotency_conflict`. (Under `REDACT_BODIES` only the recipient can be compared.) |
| 3 | High | Pairing | `registered` was true whenever `creds.json` existed, but Baileys writes it as soon as a pairing code is requested. Reloading the page mid-pairing showed "linked session exists" and forced Unlink. | Reads the real `registered` flag (cached by mtime) and prefers the live socket. |
| 4 | High | Pairing | After a QR/pairing timeout the old closed socket was reused, so "Get pairing code" failed until restart. Codes were also requested before the handshake finished. | Dead socket is replaced; waits (≤10 s) for the handshake; clear 503 if not ready. |
| 5 | High | Reconnect | Close code 440 (`connectionReplaced`) was retried forever, so two servers on one session kick each other (ban risk). | Reconnect pauses and the UI explains it. |
| 6 | Med | Reconnect | `fetchLatestBaileysVersion()` had no timeout; one hung request wedged the single-flight connect permanently. | 8 s timeout, falls back to the bundled version. |
| 7 | Med | Lifecycle | Every Unlink stacked another 60 s reconcile interval; Unlink could also restart WhatsApp during shutdown. | Singleton timer, cleared on close; no restart once stopping. |
| 8 | Med | Privacy | Admin "Quick test" ignored `REDACT_BODIES` and stored plaintext. | Honoured. |
| 9 | Med | Admin API | Test send had no length cap, and an unknown `project_id` silently used a different project. | 400 / 404. |
| 10 | Med | Admin API | `?q=a&q=b` (or repeated `project`/`status`) → TypeError → 500. | 400 `invalid_param`. |
| 11 | Low | Delivery | A send that timed out was recorded as a plain failure although WhatsApp may still deliver it (Retry then duplicates). | Error text says delivery is unconfirmed. |
| 12 | Low | Ops | `connection.log` grew without bound; `getStatus()` hit the filesystem on every poll. | 1 MB rotation; cached read. |
| 13 | Low | Security | `/api/v1/status` was the only public route without a rate limit. | Added. |
| 14 | Med | Tooling | `npm test` (`node --test test/`) crashes on Node ≥ 22. | Points at the test file. |
| 15 | Med | UI | Status polling forked a second chain on every tab-visibility/online event. | In-flight guard. |
| 16 | Med | UI | Changing a log filter while a request was in flight was dropped, leaving results for the wrong filter. | Latest request wins. |
| 17 | Low | UI | Auto-refresh discarded pages the user had loaded with "Load more". | Pauses beyond page 1. |
| 18 | Med | UI | Pair page re-rendered every 5 s, destroying keyboard focus on Unlink. | Re-renders only on real change. |
| 19 | Med | UI | Quick test looked for the message in the latest 3 rows, so on a busy server it hung at "Delivering…". | New `GET /admin/messages/:id`. |
| 20 | Low | UI | Destructive dialogs focused the destructive button (stray Enter = revoke/unlink). | Focus starts on Cancel. |
| 21 | Low | UI | Edit/New key/Toggle threw if the project list reloaded underneath. | Null guards. |
| 22 | Low | UI | Python snippet generator rewrote the word "true" inside payloads. | Removed. |

## Open — not changed, your call

- **CSP is not as strict as `FIXES.md` S-04 claims**: `style-src 'unsafe-inline'` is needed because the UI JS emits many `style=""` attributes. Moving those to classes lets you drop it.
- **OTP delivery**: the code is sent *before* the DB row is written (a DB failure leaves the user with an unverifiable code) and it bypasses the queue's pacing, so OTP bursts are unthrottled against WhatsApp.
- **No `onWhatsApp()` check**: sending to a number without WhatsApp is reported as `sent`.
- **UI dialogs close before the server answers**: a `name_taken` error loses what the user typed.
- Admin lockout is per IP: without `TRUST_PROXY` behind a proxy, one attacker locks everyone out (documented in `.env.example`).
- `FailureLimiter` is a fixed window although commented "sliding".
- Repo hygiene: `proposal(2).html/.pdf` are byte-identical copies of the brochure (≈6 MB); `tests/` is a legacy suite that `npm test` never runs; `.gitignore` says `npm run build` but the real command is `build:local`.
