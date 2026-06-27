# 🐊 Crocs — AgentForge Security

**Crocs** is AgentForge's built-in security layer — the tough shell around your
data, your accounts, and especially the ability to act on your behalf (like
sending email). This document is the honest, complete picture: what we protect,
how, and where the boundaries are.

> Design principle: **the AI can never take an irreversible action on its own.**
> Anything that touches the outside world (sending mail, calendar) is either
> read-only or requires *your* explicit, authenticated confirmation.

---

## 1. The big question: can someone make it send fake emails?

To send an email as you, an attacker would need **all** of these at once:

1. A **valid session token** for *your* account (Crocs: short-scoped JWT, see §3).
2. To hit the send endpoint, which is **per-user scoped** — a token for user A
   can't send user B's drafts (Crocs: ownership checks on every row).
3. Your Gmail **OAuth token**, which lives in the **OS keychain**, not in the
   database or any file the web app can read (Crocs: §4).
4. To get past the **human-approval gate** — the AI only ever creates a *draft*;
   the actual send requires a deliberate click in your signed-in session
   (Crocs: §2).

The model **cannot** send by itself. There is no code path where an agent's tool
call sends an email. The `draft_email` tool only writes a `pending` row; sending
is a separate, authenticated, user-initiated request.

---

## 2. The human-approval gate (email + calendar)

| Tool | What the AI can do | What requires you |
| --- | --- | --- |
| `fetch_recent_emails` | read recent inbox (read-only scope) | — |
| `draft_email` | create a **pending** draft | **You** press *Send* in the confirm card |
| `add_calendar_event` | create an event | (write scope; you can revoke anytime) |

Sending flow:
```
agent → draft_email → EmailDraft(status="pending")
UI    → shows the draft (To/Subject/Body) with Send / Cancel
you   → POST /api/emails/{id}/send   (needs YOUR auth token)
server→ verifies the draft is yours + status pending → sends via Gmail
```
No token, no ownership, or no click → no send.

---

## 3. Identity & sessions

- **Passwords**: hashed with **PBKDF2-HMAC-SHA256** (200k iterations, random
  salt). Raw passwords are never stored or logged.
- **Sessions**: stateless **JWT (HS256)** signed with a secret generated once
  and stored under `data/`. Sent as `Authorization: Bearer`.
- **Brute-force protection (Crocs rate limits)**: login `10/min`, signup
  `5/5min`, admin login `8/min`, email send `20/min` — per IP. Excess → `429`.
- **Per-user isolation**: every agent, chat, memory, reminder, note, draft, and
  connection is scoped to a `user_id`; every query filters by the authenticated
  user. User A can never read or act on user B's data.

---

## 4. Secrets at rest — keys & tokens

| Secret | Where it lives | Exposed by the API? |
| --- | --- | --- |
| Groq / Gemini API keys | **OS keychain** (Win Credential Mgr / macOS Keychain) | **Never in full** — admin panel shows only a mask (`gsk_…last4`) |
| Gmail OAuth token | **OS keychain**, per user | Never returned by any endpoint |
| JWT signing secret | `data/auth_secret.txt` (local, gitignored) | No |
| `.env` (your keys) | local file, **gitignored** | No |

- Adding a key via the admin panel is **write-only**: it goes into the keychain
  and can never be read back out — not even by an admin. So the panel is not a
  way to *exfiltrate* keys.
- Keys never appear in logs or responses.

---

## 5. The admin console

- Lives on a **separate page (`/admin`)** with its **own credentials**
  (`ADMIN_USERNAME`/`ADMIN_PASSWORD`, default `dj`/`dj` — change for production).
- Protected by an **admin-scoped token**. A normal user token gets **403** —
  regular users can never reach admin endpoints (verified).
- A user can be granted admin (then signs in with their own email+password).
- Shows usage/insights and **masked** keys only.

---

## 6. Web-layer hardening (Crocs)

- **XSS defence**: the model's Markdown output (which can quote fetched web
  content) is rendered through **DOMPurify** with a strict tag/attr allow-list
  and `https`/`mailto`-only links. Scripts, event handlers, and `javascript:`
  URIs are stripped. This matters because an XSS could otherwise steal the
  session token.
- **Security headers** on every response: `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY` (anti-clickjacking), `Referrer-Policy: no-referrer`,
  restrictive `Permissions-Policy`.
- **CORS** is restricted to the configured frontend origin(s) with credentials —
  not a wildcard.

---

## 7. Honest boundaries (what Crocs does NOT claim)

Being straight with you matters more than marketing:

- **Local data at rest** is protected by your OS account, not app-level
  encryption. The SQLite DB and Chroma store are readable by anyone with access
  to your unlocked machine/disk. Use full-disk encryption (BitLocker/FileVault)
  for device-level protection.
- **HTTPS in production is on you.** On `localhost` everything stays on the
  loopback (safe). If you host AgentForge on a public URL, you **must** put it
  behind HTTPS, or tokens and any key you add travel in clear text.
- **Token theft via a compromised browser/extension** is outside the app's
  control. Crocs reduces blast radius (XSS sanitised, send needs a click) but no
  web app can fully defend a fully compromised client.
- **Default admin `dj`/`dj`** is for convenience — change it before exposing the
  app to anyone else.

---

## 8. Production hardening checklist

- [ ] Set strong `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env`.
- [ ] Serve over **HTTPS**; set `FRONTEND_ORIGIN` to the real domain.
- [ ] Shorten JWT lifetime / add refresh tokens for shared deployments.
- [ ] Add a **Content-Security-Policy** header once asset hosting is fixed.
- [ ] Move rate limiting + sessions to Redis for multi-instance scaling.
- [ ] Keep full-disk encryption on the host machine.

---

### Summary

> **Crocs** = human-approval gate for actions · keychain-stored secrets that
> never leave · masked, write-only key management · PBKDF2 passwords + scoped
> JWTs · per-user isolation · rate limiting · sanitised output · hardened
> headers. The AI assists; **only you** can send.
