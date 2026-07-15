# AgentFury Browser Extension

A Chrome/Edge (Manifest V3) extension that puts AgentFury directly in the
browser: a popup for quick chat/priority-inbox/drafts/reminders, and an AI
toolbar injected into every **Gmail compose box** for correcting, rewriting,
or generating email text — without leaving Gmail.

It's a thin client: all the intelligence (LLM calls, priority triage,
Autopilot, memory) runs on the same cloud backend as the web app and desktop
app. Signing in once shares your account across all three.

## What it does

**Popup** (click the toolbar icon):
- **Chat** — talk to your Assistant agent right from the browser
- **Priority** — see today's flagged important emails
- **Drafts** — send/cancel pending email drafts the AI prepared
- **Remind** — quickly add a reminder

**Gmail compose toolbar** (auto-injected into every compose window):
- **Improve** — fix grammar/spelling, tighten wording
- **Shorten** — make it punchier
- **Formal** / **Friendly** — rewrite in that tone
- **Write for me…** — type an instruction ("politely decline and ask to
  reschedule") and get a complete draft body

## Install (unpacked, for now — not yet on the Chrome Web Store)

1. Open `chrome://extensions` (or `edge://extensions`)
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder in this repo
5. Click the AgentFury icon in the toolbar → sign in with your AgentFury
   account (same one as the website)
6. Open Gmail (`mail.google.com`) → open Compose → the **✨ AGENTFURY**
   toolbar appears above the message body

## How it works

- `background.js` — the service worker. Owns the auth token
  (`chrome.storage.local`) and proxies every API call to
  `https://agentfury.foliofyx.in/api`, so the popup and content script never
  touch fetch/CORS/token logic directly.
- `popup.html/js/css` — the toolbar-icon popup UI.
- `content-gmail.js/css` — injected into `mail.google.com`. Watches for
  compose boxes (Gmail recreates them constantly — it's a SPA) via
  `MutationObserver`, and attaches an AI toolbar to each one.
- Backend: `POST /api/write/polish` — a single fast LLM call, no tools/memory,
  just text-in/text-out, so it's instant from any page. CORS on the backend
  allows `chrome-extension://*` origins (`app/main.py`).

## Publishing to the Chrome Web Store (later)

1. Zip the `extension/` folder contents (not the folder itself)
2. Create a $5 one-time developer account at
   https://chrome.google.com/webstore/devconsole
3. Upload the zip, fill in the listing (screenshots, description, privacy
   policy URL — reuse `https://agentfury.foliofyx.in/privacy`)
4. Submit for review (usually a few days)

Firefox: the same code works with `moz-extension://` (already allowed in
CORS) — package via `web-ext build` and submit to
https://addons.mozilla.org, only the manifest's `background` key needs a
`scripts` array instead of `service_worker` for MV2-compat if targeting older
Firefox; MV3 is supported on recent Firefox as-is.
