# Chrome Web Store submission — copy-paste package

Everything you need to fill in the Developer Dashboard form. Submission
package: `dist-extension/agentfury-extension-v1.0.0.zip` (already built,
verified — 10 files, manifest at the zip root as required).

---

## 1. Pay & create the developer account (one-time)

1. Go to **https://chrome.google.com/webstore/devconsole**
2. Sign in with the Google account you want to publish under (can be your
   personal Gmail — doesn't need to match the OAuth project's account)
3. Pay the **one-time $5 registration fee** (card payment)
4. You land on the dashboard → **"New Item"**

## 2. Upload

- Click **New Item** → upload `dist-extension/agentfury-extension-v1.0.0.zip`
- It parses the manifest automatically (name: AgentFury, version 1.0.0)

## 3. Store listing tab — copy-paste these

**Product name:**
```
AgentFury — AI Email Assistant
```

**Summary** (max 132 chars):
```
Your AI agent in the browser: correct, rewrite, or write emails in Gmail, plus quick chat, priority inbox & reminders.
```

**Description:**
```
AgentFury puts a personal AI assistant right in your browser.

GMAIL COMPOSE TOOLBAR
Every time you open Compose in Gmail, an AI toolbar appears above the message
body:
• Improve — fixes grammar and spelling, tightens the wording
• Shorten — makes it punchier while keeping the key points
• Formal / Friendly — rewrites in that tone
• Write for me — type a one-line instruction ("politely decline and ask to
  reschedule") and get a complete, ready-to-send draft

Nothing is ever sent automatically — you review and send it yourself with
Gmail's own Send button.

QUICK POPUP
Click the AgentFury icon anytime for:
• Chat with your AI assistant (research, questions, tasks)
• Priority inbox — today's flagged important emails
• Pending drafts — review and send AI-prepared replies
• Quick reminders

One account, everywhere: sign in once and your data is the same across the
AgentFury web app, desktop app, and this extension.

Free to use. Requires an AgentFury account (create one free at
agentfury.foliofyx.in).
```

**Category:** Productivity

**Language:** English

## 4. Privacy practices tab (this is what gets scrutinized)

**Single purpose description** (required — one sentence, exact purpose):
```
AgentFury lets users correct, rewrite, or generate email text inside Gmail
compose, and view their AI assistant's chat, priority inbox, and reminders
from a browser popup.
```

**Permission justifications** (paste per permission when asked):

| Permission | Justification |
|---|---|
| `storage` | Stores the user's AgentFury login session token locally so they stay signed in between browser sessions. |
| `activeTab` | Used only when the user interacts with the extension popup on the current tab; no passive tracking. |
| `scripting` | Reserved for injecting the compose toolbar UI into Gmail if needed beyond the static content script. |
| `identity` | Used only for the "Continue with Google" sign-in button (`chrome.identity.launchWebAuthFlow`) — lets the user sign in without typing a password. |
| Host: `https://mail.google.com/*` | Required to detect Gmail's compose box and inject the AI toolbar button directly above it, and to insert AI-rewritten text back into the compose box the user is actively editing. |
| Host: `https://agentfury.foliofyx.in/*` | The extension's own backend API — used to authenticate the user and process their AI requests (chat, email rewriting, priority inbox, reminders). |

**Data usage disclosure** (checkboxes — check these):
- ☑ Personally identifiable information (email address, for login)
- ☑ Website content (the text the user is actively composing in Gmail, sent
  to our API only to rewrite/generate it at the user's request)

**Certify:**
- ☑ "I do not sell or transfer user data to third parties, outside of the
  approved use cases"
- ☑ "I do not use or transfer user data for purposes unrelated to the item's
  single purpose"
- ☑ "I do not use or transfer user data to determine creditworthiness or for
  lending purposes"

**Privacy policy URL:**
```
https://agentfury.foliofyx.in/privacy
```

## 5. Screenshots (required — at least 1, 1280×800 or 640×400)

Take these on your machine and upload:
1. **Gmail compose with the ✨ AGENTFURY toolbar visible** (the hero shot —
   most important one)
2. **The popup open on the Chat tab** with a sample exchange
3. **The popup open on the Priority tab** with a couple of items
4. *(optional)* The "Write for me…" box expanded with an instruction typed in

No fancy editing needed — plain screenshots are fine and expected for a dev
tool. Crop to remove personal email addresses/content before uploading.

## 6. Icon & promo tile

- **Store icon:** already have `extension/icons/icon128.png` — upload as-is
- **Small promo tile (440×280, optional but recommended):** skip for v1, add
  later if you want more store-search visibility

## 7. Submit for review

- Click **Submit for review**
- Typical review time: **a few days to ~1–2 weeks** — extensions with a
  `mail.google.com` host permission + "Website content" data usage get closer
  scrutiny than average, so don't be surprised if it takes the longer end, or
  if Google asks a follow-up question (answer honestly using the
  justifications above — they match exactly what the code does)

## After approval

- You get a public **Chrome Web Store URL** — add it to `docs/EXTENSION.md`
  and the Landing page's Download section as a proper "Add to Chrome" button
- Updates: bump `version` in `manifest.json`, re-zip, upload as a new package
  in the same dashboard listing — no re-registration needed
