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

**On any page** (`content-global.js`, injected into every frame):
- **Select-to-ask** — highlight text and a small bar offers Answer, Google,
  Summarize, Save, or your own question
- **Copy where copying is blocked** — selection, copy, right-click and the
  Ctrl+C keystroke are restored on sites that switch them off, and the
  highlight is made visible again. Where a page still resists, **Alt+click**
  any paragraph grabs its text straight out of the DOM — no selection needed
- **Image AI** — hover any image for an AI badge in its corner: extract the
  text in it (OCR), explain it, translate it, solve the question in it, ask
  about it, or reverse-search it. Alt+click an image does the same
- **Auto-edit** — focus any text field for an AI badge in its corner: fix,
  shorten, formalize, or answer what's in it, applied straight into the field
  with Undo. Works on the whole field, so nothing has to be highlighted
- **Suggestions while you type** — the badge turns into a live count of
  spelling/grammar issues. Two passes: a local rule + misspelling table that
  runs on every keystroke with no network at all, and `/write/proof` on a
  ~900ms pause, which returns exact `before → after` fragments (never a
  rewrite) so accepting one leaves the rest of the sentence alone
- **Snip & read** — Alt+Shift+S (or right-click → "read text on screen")
  captures the visible tab, you drag a box, and the crop goes through OCR.
  This is the answer for text that is in no DOM at all: painted on a canvas,
  inside a video frame, or in a plugin's own viewport
- **Copy anywhere** — "Copy page text" on the bar, "Copy image" on the image
  card, a "Copy with AgentFury" right-click item, and a bindable `force-copy`
  shortcut that copies the selection or, failing that, whatever block is under
  the pointer. Paste-blocking is undone the same way copy-blocking is
- **Document assistant** — a PDF/doc opened in the tab gets a card that can
  parse, search, summarize or explain it

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
5. Click the AgentFury icon in the toolbar → sign in (email/password, or
   **Continue with Google** — see one-time setup below) — same account as the
   website
6. Open Gmail (`mail.google.com`) → open Compose → the **✨ AGENTFURY**
   toolbar appears above the message body

### One-time setup for "Continue with Google" in the extension

Chrome extensions can't use the website's redirect-to-a-page OAuth flow —
instead Chrome gives each extension its own
`https://<extension-id>.chromiumapp.org/` redirect URI
(`chrome.identity.launchWebAuthFlow`). That URI must be added to the SAME
Google OAuth client the website uses:

1. Load the extension unpacked (steps above) → open `chrome://extensions` →
   note the **ID** shown under AgentFury (a long lowercase string)
2. Go to **Google Cloud Console → APIs & Services → Credentials** → open your
   OAuth 2.0 Client ID
3. Under **Authorized redirect URIs**, add:
   `https://<that-extension-id>.chromiumapp.org/`
4. Save

Once published to the Chrome Web Store, the extension gets a **permanent**
ID (shown on the Developer Dashboard) — add that one too, so both the dev
(unpacked) and published versions work.

## How it works

- `background.js` — the service worker. Owns the auth token
  (`chrome.storage.local`) and proxies every API call to
  `https://agentfury.foliofyx.in/api`, so the popup and content script never
  touch fetch/CORS/token logic directly.
- `popup.html/js/css` — the toolbar-icon popup UI.
- `content-gmail.js/css` — injected into `mail.google.com`. Watches for
  compose boxes (Gmail recreates them constantly — it's a SPA) via
  `MutationObserver`, and attaches an AI toolbar to each one.
- `content-global.js` — injected into every page **and every frame**
  (`all_frames`), because the sites people most need this on (course players,
  document viewers, embedded readers) put their content inside an iframe. All
  of its UI renders in a closed Shadow DOM so page CSS can't leak in and page
  JS can't reach it. Per-frame gating keeps it sane: the corner bubble and the
  document card are top-frame only, UI is skipped in frames too small to hold
  it, and tiny ad/tracking frames get the copy-restore layer only.
- `app/util/answer_pipeline.py` — the three cheap stages wrapped around every
  fast answer, which is where most of the quality and nearly all of the cost
  saving lives:
  - **pre**: `clean_input` (strip cookie/nav furniture and duplicated lines,
    normalize, and trim keeping the HEAD **and TAIL** — a multiple-choice
    question's options are at the end), `detect_kind` (mcq / question / code /
    term / passage, by regex) so the prompt is specific rather than generic.
  - **RAG**: `pack_context` ranks, de-duplicates (by URL and by title, so one
    syndicated story doesn't eat the budget), trims each snippet at a word
    boundary and numbers them inside a character budget. Lexical scoring only:
    no embeddings, no vector store, no added latency.
  - **post**: `clean_output` (drop `<think>` monologues, "Sure! Here's...",
    and the LaTeX markers vision models sprinkle into a diagram description),
    `fix_citations` (delete `[7]` when only 4 sources exist).
  - plus `answer_cache` (in-process TTL+LRU — an identical repeat costs
    nothing) and `pick_model` (the strong model only for code or long input).
- Backend, all single fast LLM calls (no tools/memory — text in, text out, so
  they're instant from any page):
  - `POST /api/write/polish` — fix / shorten / formal / friendly / write
  - `POST /api/write/answer` — answer or explain a selection
  - `POST /api/write/proof` — exact, applyable corrections for live typing
  - `GET  /api/write/search-answer` — hedged web search + a cited answer
  - `POST /api/write/image` — read an image: OCR, explain, translate, solve,
    or answer a question about it. Needs a MULTIMODAL model, which the
    text-only GPT-OSS default is not: `app/llm/router.py::get_vision_llm`
    returns every multimodal model available, best first — Gemini when a
    Gemini key exists, then Groq's `settings.vision_model` (default
    `qwen/qwen3.8-27b`, overridable at runtime) — and the endpoint falls
    through to the next one if a provider retires a model id under it. The
    extension sends the pixels itself when it can read them (canvas or a CORS
    fetch, downscaled to 1280px JPEG); when the page won't release them it
    sends the URL and the backend fetches it, behind an SSRF guard that
    refuses private/loopback addresses.
  CORS on the backend allows `chrome-extension://*` origins (`app/main.py`).

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
