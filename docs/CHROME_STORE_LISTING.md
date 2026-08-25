# Chrome Web Store submission — copy-paste package

Everything you need to fill in the Developer Dashboard form. Submission
package: `dist-extension/agentfury-extension-v1.20.0.zip` (already built and
verified — manifest at the zip root as required).

> If you already have an item uploaded, this is now **v1.20.0** — upload the
> new zip as a new package version on the SAME item (Package tab → Upload new
> package), you don't need to re-register.

---

## 1. Pay & create the developer account (one-time)

1. Go to **https://chrome.google.com/webstore/devconsole**
2. Sign in with the Google account you want to publish under (can be your
   personal Gmail — doesn't need to match the OAuth project's account)
3. Pay the **one-time $5 registration fee** (card payment)
4. You land on the dashboard → **"New Item"**

## 2. Upload

- Click **New Item** → upload `dist-extension/agentfury-extension-v1.20.0.zip`
- It parses the manifest automatically (name: AgentFury, version 1.0.0)

## 3. Store listing tab — copy-paste these

**Product name:**
```
AgentFury — AI Email Assistant
```

**Summary** (max 132 chars — the manifest description; includes the spaced
"Agent Fury" form so both "agent fury" and "agentfury" store searches match):
```
Agent Fury: AI agent & assistant in your browser — ask about any text you select, write & fix email in Gmail, plus reminders.
```

**Description** (keyword-woven for search: "Agent Fury", "AI agent",
"AI assistant", "Gmail AI"; reflects the CURRENT features — side panel, Notes,
select-to-ask, copy on blocked sites, Google/Gemini search):
```
Agent Fury is your personal AI agent and assistant, right inside your browser. Highlight text on any page, get AI help in Gmail, and keep your priorities, reminders, and notes one click away.

ASK ABOUT ANYTHING YOU SELECT
Highlight text on any webpage — like you would to "Search Google for…" — and a small bar appears. Explain it, summarize it, ask your own question, or send it straight to Google or Gemini. One-click actions let you save the highlight as a reminder, a note, or to your AI's memory — great for students capturing study material as they read. It even works on pages that block copying.

GMAIL AI WRITER
Open Compose in Gmail and an AI toolbar appears above the message:
• Improve — fixes grammar and spelling, tightens the wording
• Shorten — makes it punchier while keeping the key points
• Formal / Friendly — rewrites in that tone
• Write for me — type a one-line instruction ("politely decline and ask to reschedule") and get a complete draft, then refine it with follow-ups before inserting

Nothing is ever sent automatically — you review and send with Gmail's own Send button.

SIDE PANEL
Click the Agent Fury icon to open a side panel with:
• Ask — a quick question to your AI assistant
• Priority inbox — today's flagged important emails
• Drafts — review and send AI-prepared replies
• Reminders and Notes — add and manage, right there

One account, everywhere: sign in once (including "Continue with Google") and your data is the same across the AgentFury web app, desktop app, and this extension.

Free to use. Create a free account at agentfury.foliofyx.in.
```

**Category:** Productivity

**Language:** English

## 4. Privacy practices tab (this is what gets scrutinized)

**Single purpose description** (required — one sentence, exact purpose):
```
AgentFury lets users ask their AI assistant about text they select on any
webpage, correct/rewrite/generate email text inside Gmail compose, and view
their AI assistant's chat, priority inbox, and reminders from a browser
popup.
```

**Permission justifications** (paste per permission when asked):

| Permission | Justification |
|---|---|
| `storage` | Stores the user's AgentFury login session token locally so they stay signed in between browser sessions. |
| `activeTab` | Used only when the user interacts with the extension popup on the current tab; no passive tracking. |
| `scripting` | Reserved for injecting UI beyond the static content scripts if a future feature needs it. |
| `identity` | Used only for the "Continue with Google" sign-in button (`chrome.identity.launchWebAuthFlow`) — lets the user sign in without typing a password. |
| `alarms` | Schedules a once-per-minute background check for new priority emails and AI-drafted replies, so the user is notified without having to open the extension. |
| `notifications` | Shows a native OS notification when new priority mail or an AI draft is found, and displays a badge count on the toolbar icon. |
| `contextMenus` | Adds a right-click "Ask AgentFury about…" entry when text is selected, as an alternative to the select-to-ask bar. |
| `sidePanel` | Opens AgentFury as a native browser side panel when the toolbar icon is clicked (Chat/Priority/Drafts/Reminders), instead of a small dropdown popup. |
| Host/content script: `<all_urls>` | Lets the user select text on ANY page and ask their AI assistant about it (the core "select-to-ask" feature) — the same way a browser's built-in "Search Google for…" works on any selection. The content script only activates on an active text selection; it does not read page content otherwise. |
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
