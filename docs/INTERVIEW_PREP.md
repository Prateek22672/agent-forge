# AgentFury — Interview Prep

Everything about what this project is, how it's built, and — most importantly —
**why** each decision was made. Interviewers rarely reward "I used X"; they reward
"I used X *because* Y, and the tradeoff was Z." This doc is written that way.

Read §0 and §1 if you only have ten minutes. Read §12 the morning of.

---

## 0. The 30-second pitch

> AgentFury is a personal AI agent platform. You create agents that actually *do*
> things — read and draft your email, set reminders, search the web, remember what
> matters about you — and they run everywhere you do: a web app, a desktop app, and
> a Chrome extension, all sharing one account and one backend.
>
> The core design idea is **"an agent is data, not code."** An agent is a database
> row — a name, a system prompt, a list of tool names, a model. The runtime turns
> that row into a live agent on demand. That's what lets a user create any agent
> they want without anyone writing code for it.
>
> The core safety idea is that **the AI never takes an irreversible action alone.**
> It can *draft* an email; only a human click sends it.

**Stack in one line:** FastAPI + SQLAlchemy + Postgres, LangGraph for the agent
loop, Groq/Gemini for inference, Chroma for semantic memory, React + Vite + Tailwind
on the front, Electron for desktop, Chrome MV3 for the extension.

---

## 1. The three ideas that define the project

If you remember nothing else, remember these. Every follow-up question can be
answered by reasoning from one of them.

### Idea 1 — "Agent = data"

An `Agent` row (`backend/app/models.py`) is:

```python
name, description, system_prompt, tools (JSON list), model, temperature
```

That's the whole agent. `app/agents/runtime.py` reads the row and constructs a live
LangGraph agent per turn. Nothing is hard-coded per agent.

**Why it matters:** the alternative is a class per agent type (`class EmailAgent`,
`class SearchAgent`), which means every new capability is a code deploy. With
agent-as-data, a user creates a new agent from the UI in five seconds, and it's a
first-class agent with real tools. The product promise — "create your own agents" —
is only possible because of this.

**Tradeoff to mention:** you lose compile-time guarantees. A row can reference a
tool name that doesn't exist. `build_tools()` handles that by resolving names
against a registry and silently skipping unknowns, so a bad row degrades instead of
crashing.

### Idea 2 — "Crocs" (the human-approval gate)

Named security layer, documented in `docs/CROCS_SECURITY.md`. The principle:

> The AI can never take an irreversible action on its own.

Concretely: the agent has a `draft_email` tool, **not** a `send_email` tool. Calling
it writes an `EmailDraft` row with `status="pending"`. The email leaves the building
only when the logged-in user clicks confirm, hitting `POST /api/emails/{id}/send`.

**Why it matters:** this is the single most reassuring thing you can say about an
agent product. Every LLM hallucinates; the question is what it can *do* when it
does. Here: nothing you can't undo.

Same principle elsewhere: API keys are write-only (added, never returned — the admin
panel shows `gsk_ab12…9f4c`), OAuth tokens are never returned by any endpoint, and
account suspension is manual-review-only, never automatic.

### Idea 3 — Graceful degradation everywhere

Free infrastructure fails constantly: rate limits, cold starts, flaky models. So
nearly every path has a fallback:

| Layer | Primary | Fallback |
|---|---|---|
| Inference | Groq key #1 | other Groq keys → Gemini → tool-free retry |
| Priority classify | gpt-oss-120b | gpt-oss-20b → keyword safety net |
| Email fetch | Gmail OAuth | IMAP app password |
| Secrets | OS keychain | Fernet-encrypted DB row → JSON file |
| Web search | `auto` backend | google → bing → brave → duckduckgo |

**The line to use:** "I assumed every external dependency would fail, and designed
so a failure degrades the experience instead of breaking it."

---

## 2. System architecture

```
                        ┌──────────────────────────┐
   Web (Vercel) ───────▶│                          │
   Desktop (Electron) ─▶│   FastAPI backend        │──▶ Postgres (Render)
   Chrome extension ───▶│   (Render, free tier)    │──▶ Chroma (vectors)
                        │                          │──▶ Keychain / Fernet secrets
                        └────────────┬─────────────┘
                                     │
                     ┌───────────────┼────────────────┐
                     ▼               ▼                ▼
                Groq / Gemini    Google APIs     Web Push (VAPID)
                (inference)    (Gmail, Calendar)
```

**One backend, three clients.** The desktop app is an Electron shell pointed at the
live web app — not a bundled copy — so accounts and data are shared by construction,
not by sync. The extension talks to the same REST API the web app does.

**Why that's the right call:** three codebases with three data models is how you get
"it works on web but not desktop" bugs forever. One API means one source of truth.

### Request lifecycle (worth being able to narrate)

1. Client sends `Authorization: Bearer <JWT>`.
2. CORS middleware — explicit origins only, plus a regex for `chrome-extension://*`
   (extension IDs vary per install, so they can't be enumerated).
3. Security-headers middleware (`nosniff`, `DENY` framing, no referrer).
4. Telemetry middleware starts a timer.
5. `get_current_user` dependency decodes the JWT, loads the `User`.
6. Route handler runs; ownership is checked per row (`agent.user_id == user.id`).
7. Telemetry middleware records duration; logs to `ErrorLog` if 5xx.

---

## 3. The agent runtime — the heart of it

`backend/app/agents/runtime.py`, function `run_agent(agent, history, user_message, user)`.

### What happens on one chat turn

**Step 1 — Build the model and tools.**
`get_llm(agent.model, agent.temperature)` and `build_tools(agent.tools, agent.id, agent.user_id)`.

**Step 2 — Build the system prompt.** This is where personalization is injected, and
it's the part most worth explaining because it shows you understand that prompt
construction *is* engineering:

- the agent's own `system_prompt`
- a tone guide selected from `user.tone` (friendly / concise / professional / playful)
- the user's free-text `about`
- **semantic recall**: `vector_store.recall_user(user.id, message, k=4)` — facts
  about this user, retrieved by meaning, not keyword
- agent-scoped recall if the agent has `remember`/`recall` enabled
- a tool-discipline guardrail ("max 3 searches, no near-duplicate queries")

**Step 3 — Run the ReAct loop.**
`create_react_agent(llm, tools).invoke(messages, config={"recursion_limit": 24})`

**Step 4 — Failover.** The call is wrapped in a loop over `[primary, *get_failover_llms()]`.

**Step 5 — Last resort.** If *every* model failed with tools bound, retry each one
**without tools** and a "answer from your own knowledge" instruction. Reason: the
most common failure isn't the model being down, it's a model emitting a malformed
tool call. Stripping tools rescues those.

**Step 6 — Extract traces.** Pair `AIMessage.tool_calls` IDs to `ToolMessage` outputs
so the UI can show "it searched for X, got Y" — agent transparency.

**Step 7 — Post-processing.** `_clean_text()` strips gpt-oss "harmony" artifacts
(`<|...|>`, `assistant to=functions`). A separate thread generates three follow-up
suggestion chips with a 2.5s timeout — if it's slow, the user never waits for it.

### What LangGraph actually gives you

Be precise here, it's a likely question. `langgraph.prebuilt.create_react_agent`
provides the **ReAct loop as a state graph**: binding tool schemas to the model,
parsing tool calls, executing them, feeding results back, and deciding when to stop.

**Why use it instead of a hand-rolled `while` loop?** The hand-rolled version is
~150 lines of message-format bookkeeping that breaks differently on every provider.
LangGraph normalizes that.

**What we deliberately don't use:** no persistent checkpointer. Short-term memory is
just the DB message history replayed each turn. Simpler, and it means conversation
state lives in one place (Postgres) rather than two.

---

## 4. The tool system

`backend/app/tools/registry.py` — `build_tools(names, agent_id, user_id)` resolves
tool names into callables in four categories:

| Category | Tools | Notes |
|---|---|---|
| Static | `web_search`, `fetch_url`, `calculator`, `current_datetime`, `list_files`, `read_file`, `write_file` | Stateless, module-level |
| Per-user | `fetch_recent_emails`, `draft_email`, `add_calendar_event`, `list_upcoming_events` | Closures capturing `user_id` |
| Task | `create_reminder`, `list_reminders`, `create_note` | **Always bound**, even if not in the agent's list |
| Memory | `remember`, `recall` | Closures capturing `agent_id` |

**Two details worth volunteering:**

*Task tools are always bound.* If a user says "remind me about this" mid-conversation
with their Web Search agent, it should just work. Requiring them to have picked the
right tool in advance is a bad product. This also means agents created before
reminders existed gained the capability for free.

*The calculator never uses `eval`.* It parses to an AST and walks it against a
whitelist of node types. `eval` on LLM output is remote code execution with extra
steps. Similarly `read_file`/`write_file` resolve paths and verify they're inside a
sandbox root — the classic `../../etc/passwd` check.

---

## 5. LLM routing and key rotation

`backend/app/llm/router.py` and `backend/app/keys.py`.

### Provider selection

Read from runtime settings each call (not env, so it's changeable without a deploy):

- `"groq"` (default) — fast, generous free tier
- `"gemini"` — different provider entirely
- `"ollama"` — fully local, nothing leaves the device

### Key rotation — a good "systems thinking" story

Groq rate-limits **per API key**. Multiple keys = multiplied throughput. So:

```python
def _next_groq_key():
    with _lock:                       # thread-safe
        keys = keys_module.groq_keys()  # read the LIVE pool each call
        key = keys[_index % len(keys)]
        _index += 1
    usage.record("groq", key[-4:])     # per-key usage counters
    return key
```

Two subtleties to point out:

1. **The pool is read fresh every call.** A key added in the admin panel takes
   effect on the next request — no restart. (This was an actual bug: an early
   version captured the pool at import time, so new keys never rotated in.)
2. **Clients are `@lru_cache`d on `(model, temperature, api_key)`** — rotation
   picks a key, but doesn't rebuild an HTTP client every request.

### The failover chain

`get_failover_llms()` returns, in order:

1. One Groq client per *additional* key — a different credential is an independent
   rate-limit bucket.
2. A Gemini client — different provider entirely, so it survives a Groq outage, and
   also rescues model-specific malformed-tool-call failures.

**"How many keys do I need?"** Rough rule: Groq's free tier is ~30 req/min/key. One
chat turn with tools is 2–4 model calls. So one key ≈ 8–15 active conversations per
minute. **3–5 Groq keys plus 1–2 Gemini keys** comfortably covers early usage; past
that, the bottleneck stops being keys and becomes the free Render instance.

---

## 6. Memory — three distinct layers

A commonly-asked question is "how does it remember things?" There are three answers,
and knowing they're different is the point.

| Layer | Storage | Lifetime | Used for |
|---|---|---|---|
| Short-term | `messages` table | One conversation | Chat coherence — replayed each turn |
| Structured | Postgres rows | Permanent | Reminders, notes, drafts, priority mail |
| Semantic | Chroma vectors | Permanent | "What do I know about this user?" |

### The semantic layer

Two kinds of collection:

- `agent_{agent_id}` — what one agent learned
- `user_{user_id}` — what's true about the person, **shared across all their agents**

That second one is why a fact learned while chatting with the Email agent shows up
when talking to the Research agent. Embeddings are local (all-MiniLM via Chroma's
default) — no API key, no per-embedding cost, no data leaving for embedding.

### Brain facts — the interesting bit

`backend/app/brain.py`. After every turn, a **daemon thread** asks a fast cheap model
(`llama-3.1-8b-instant`) to extract *at most one* durable fact as strict JSON. It
dedupes against existing facts by normalized containment, then writes both a
`BrainFact` row (user-visible and deletable) and a vector entry (semantically
searchable).

**Two design points worth making:**

1. **It runs in a background thread**, so fact extraction never adds latency to the
   user's reply.
2. **It still runs when `save_history=False`.** Privacy mode discards the transcript
   but keeps the distilled fact — you get personalization without a stored
   conversation log. That's a genuinely nice privacy/utility tradeoff and a great
   thing to be asked about.

---

## 7. Auth and security

### Passwords
PBKDF2-HMAC-SHA256, **200,000 iterations**, 16-byte random salt, stored as
`pbkdf2_sha256$iterations$salt$hash`. Verified with `hmac.compare_digest` (constant
time — prevents timing attacks).

*If asked "why not bcrypt/argon2?"* — they're better; PBKDF2 was chosen because it's
in the Python standard library, so zero dependencies. With 200k iterations it's
still solidly in the acceptable range. Know the tradeoff; don't pretend it's optimal.

### Sessions
Stateless **JWT (HS256)**, 30-day expiry, payload `{sub: user_id, exp}`.

*Tradeoff:* stateless means no server-side revocation — a stolen token is valid until
expiry. Acceptable here; a production banking app would want short-lived tokens plus
a refresh token and a revocation list.

### Two separate token tracks
This is a nice detail. Admin tokens carry `scope: "admin"` and `require_admin()`
rejects any token without it. So a **regular user token can never reach
`/api/admin/*`**, even for a user with `is_admin=True` — they must log in again at
the admin console. Different `localStorage` keys, different 401 events, different
login screens.

### OAuth state
The Google callback arrives with no auth header — so how do you know who started the
flow? A **signed, 10-minute JWT** carried in the `state` parameter, containing either
`{uid}` (connect flow) or `{login: true}` (login flow), plus `{desktop}`. Signed, so
it can't be forged; short-lived, so it can't be replayed.

### Secret storage — three backends, auto-selected
1. **Cloud** (`DATABASE_URL` set) → Fernet-encrypted DB row. Key derived from
   `sha256(SECRET_KEY)`, so **a leaked database dump is useless** without the env var.
2. **Local** → OS keychain via `keyring` (Windows Credential Manager, macOS Keychain,
   libsecret).
3. **Headless fallback** → JSON file.

### Rate limiting
In-memory sliding window keyed `ip:path`. Login 10/min, signup 5/5min, admin login
8/min, email send 20/min.

*Known limitation, say it before they ask:* in-memory means per-instance. Scaling to
multiple backend instances requires moving this to Redis.

---

## 8. Google integration — three OAuth paths

Worth knowing cold, because "why three?" is a great question with a real answer.

### Scope tiers — login-first incremental consent

- `LOGIN_SCOPES` = `openid`, `email`, `profile` — non-sensitive, **no scary
  "unverified app" warning**
- `DATA_SCOPES` = `gmail.readonly`, `gmail.send`, `calendar.events` — restricted,
  requires Google verification

**Why split them:** if sign-in requested Gmail scopes, every new user would hit a
full-page security warning at the moment of first impression. Splitting means signup
is clean, and the scarier consent screen only appears when the user deliberately
clicks "Connect Gmail" — at which point they understand why.

### The three paths

| Client | Mechanism | Why it's different |
|---|---|---|
| **Web** | Standard redirect → `/api/connections/google/callback` → redirect back with `?token=` | The normal flow |
| **Desktop** | Same, but the callback returns an HTML page that navigates to `agentforge://auth?...` | Browsers **refuse** to auto-launch a custom protocol from a plain HTTP redirect, so you need a real page with a user-visible fallback button |
| **Extension** | `chrome.identity.launchWebAuthFlow` → own `https://<ext-id>.chromiumapp.org/` redirect → `POST /api/auth/google/extension-token` | An extension has no server to receive a redirect; Chrome provides a synthetic one |

All three converge on `app/google_login.py :: login_or_create_user()` — one place
that decides find-or-create rules. **That's the point of the refactor:** three entry
paths, one identity rule.

### A real bug worth telling

When exchanging the code, `OAUTHLIB_RELAX_TOKEN_SCOPE=1` is set (Google sometimes
returns scopes in a different order than requested). But under relaxed checking,
`credentials.scopes` reflects **requested** scopes, not **granted** ones. So if a
user unchecked Gmail on the consent screen, the UI would still show "Gmail
connected" — and then every Gmail call would fail confusingly.

Fix: after the exchange, override `creds._scopes` with the granted scopes from the
raw token response, and assert the specific scope before each API call.

**Why this is a good story:** it's a subtle bug, the failure mode was misleading UI
rather than a crash, and the fix required understanding what the library was actually
doing rather than trusting its surface API.

---

## 9. Autonomous features — Autopilot and priority mail

### How background work runs

**No in-process scheduler.** Two cron endpoints, hit by an external pinger:

- `POST /api/cron/fire-reminders` — every minute
- `POST /api/cron/scan-priority` — every ~15 minutes

Both are guarded by a shared secret, both **ACK immediately** and do the work on a
daemon thread with a module-level lock.

**Why that shape:** the free Render instance sleeps after inactivity, and a cron
pinger times out around 30 seconds. Doing work synchronously would mean the pinger
kills a pass mid-flight. Returning instantly and working in the background sidesteps
that, and the lock ensures two passes never overlap. As a bonus, the minute-ping
keeps the instance awake.

### Priority inbox

`app/priority.py`. Fetches inbox metadata, sends the **whole batch in one prompt** to
`gpt-oss-120b` (one call for 20 emails, not 20 calls), asking it to flag genuinely
important mail — placements, interviews, deadlines.

Two things to highlight:

1. **Tuned for recall, not precision.** The prompt says "when unsure, INCLUDE." A
   false positive costs a glance; a false negative costs a missed interview. Know
   which error is expensive in your domain.
2. **Keyword safety net.** If the model call fails entirely, a keyword heuristic
   includes everything that isn't obviously marketing, labelled "Needs review."
   Degraded, not broken.

Deduplication is a `sha256(user_id|sender|subject)[:32]` hash, so re-scanning doesn't
create duplicates.

### The escalation safety net

Any priority email still unacknowledged after **4 hours** gets one louder second
alert — a push plus a Google Calendar event with an alarm. This is described in the
code as the core USP: the failure mode of a notification is being missed, and one
retry catches most of those.

### Autopilot

`app/autopilot.py` — the autonomous agent. Per pass: fetch recent mail → skip
everything before a stored cursor → one triage LLM call → act.

Actions it can take: create a **pending** email draft (never sends), create a
reminder with an alarm, create a calendar event. Every action is logged as an
`AgentAction` row — the "while you were away" feed.

**Key architectural claim, stated in the code's own docstring:** this is
**deterministic orchestration with LLM decisions inside it**, *not* a free-running
ReAct loop. The code decides what may happen; the model decides which of those
things to do, for which email.

**Why:** a free-running loop with mail access and no supervision is how you get an
agent that emails your entire contact list at 3am. Bounded, cursor-deduped, logged,
and gated behind human approval for anything irreversible.

Also: on the very first pass it **only baselines the cursor and acts on nothing**, so
enabling Autopilot never triggers a flood of actions about six-month-old email.

---

## 10. The Chrome extension (MV3)

The most recent surface, and the one with the most interesting browser-specific
engineering.

### What it does
- **Select-to-ask on any page** — highlight text, get a bar with Explain / Summarize
  / Copy / Remind / Note / Brain
- **Gmail compose toolbar** — Improve / Shorten / Formal / Friendly / Write-for-me,
  with iterative refinement before inserting
- **Native side panel** — Ask / Priority / Drafts / Remind / Notes / Settings
- **Background notifications** — badge count and OS notifications for new priority mail

### MV3 architecture

```
content scripts  ──messages──▶  service worker  ──HTTPS──▶  backend
(page context)                  (owns the token,
                                 proxies all fetches)
```

**Why the service worker owns all network calls:** content scripts run in the page's
origin, so they hit CORS restrictions and would expose the auth token to page
scripts. The service worker has the extension's own origin and privileges. One
place holds the token; content scripts just send messages.

### Four browser-engineering problems worth explaining

**1. MV3 service workers die.**
They're killed after ~30 seconds idle and revived by any event — which re-runs the
top-level script every time. A badge-refresh call at the top level was therefore
firing on *every* wake, not once a minute. Fix: a timestamp in `chrome.storage` and
a 20-second minimum gap. **Lesson: in MV3 you cannot assume module-level state or
"runs once" semantics.**

**2. Selection kept vanishing on SPA sites.**
On React-heavy sites (X, feeds), the highlight would disappear. The cause wasn't our
code — the site's own re-renders silently collapse the native `Selection`. Fix: paint
our **own** highlight overlay from `range.getClientRects()`, independent of the
browser's selection state. **Lesson: don't depend on state another program owns.**

**3. Page CSS was leaking into our UI.**
On some sites our input rendered as a plain white box — the page's global
`input { background: white }` was hitting our elements, because a content-script
`<div>` in `document.body` is just another node in the page's cascade.

Fix: move the entire UI into a **closed Shadow DOM**. This solves two problems at
once:
- Style isolation — the cascade doesn't cross a shadow boundary in either direction.
- **Undetectability** — with `mode: "closed"`, `.shadowRoot` returns `null` to page
  scripts and `querySelector` can't pierce the boundary. A page can see a host
  `<div>` exists but cannot inspect or remove what's inside it.

This is the same property that makes the native side panel unblockable, applied to
in-page UI. Note the consequence that had to be handled: **event retargeting** means
document-level listeners see the *host* as `e.target`, so outside-click detection had
to change from `bar.contains(e.target)` to `e.target !== host`.

**4. Sites that block copying.**
Many sites disable text selection (`user-select: none`) or cancel `copy` /
`selectstart` / Ctrl+C. Fix, in two parts:
- Inject a stylesheet forcing `user-select: text`
- Attach capture-phase listeners **on `window`** and call
  `stopImmediatePropagation()`

The second one is the technically interesting part: capture phase flows from the
outermost node inward, so a `window` listener runs **before** any listener the page
attached to `document` or `body`, regardless of when the page's script loaded. That
neutralizes the block without knowing how it was implemented.

### Side panel vs. injected overlay — a design decision to narrate

The first version injected a floating panel via a content script. It was replaced
with Chrome's **native `chrome.sidePanel` API**. Reasons:

- A native panel is rendered **outside the page DOM entirely** — a website cannot
  detect, style, or remove it.
- It reserves real browser layout space rather than floating over content.

An injected overlay is, by contrast, just DOM: any page can `querySelector` and
delete it. When the requirement is "a site shouldn't be able to interfere with it,"
the platform API is the correct answer, not more defensive JavaScript.

---

## 11. Admin, telemetry, and moderation

### What the admin console shows
Total calls, user count, active users (7d), errors (24h); per-key request counts
(**masked**); logins by source (web / extension / desktop) so you can see which
surface people actually use; recent errors; and the slowest endpoints in 24h.

### Telemetry design
Two lightweight tables (`LoginEvent`, `ErrorLog`) written by middleware, both
**self-trimming** (`ErrorLog` caps at 2000 rows). Telemetry failures are swallowed —
instrumentation must never break the request it measures.

Source attribution uses an explicit `X-AF-Client` header from the extension, falling
back to sniffing a `chrome-extension://` origin.

### Moderation — a case worth discussing thoughtfully

The extension can defeat copy-blocking on sites. That's legitimate for the vast
majority of the web, but it could be misused.

The approach: the extension reports a `BypassEvent` when its override fires on a page
that *looks* deliberately copy-blocked. An admin sees flagged accounts grouped by
domain and can **send an in-app notice** (soft, user keeps access) or **suspend**
(blocks login until lifted, with a reason shown to the user).

**The design principle to state clearly:** *nothing is automatic.* The signal is
explicitly framed in both the code and the UI as "a signal for human review, not a
verdict," because ordinary sites trigger it constantly. Suspension is manual,
reversible, and never based on the heuristic alone.

**If asked about the ethics** — this is a genuinely good answer to have ready: the
feature exists to help people read and study content they have access to. Where a
platform has an explicit, consented monitoring arrangement with its users, working
around *that* would be helping deceive them, and the project deliberately doesn't do
it. The enforcement tooling above exists precisely so misuse can be acted on.

---

## 12. Likely questions, with answers

**"Walk me through what happens when a user sends a message."**
→ §3. Hit: system-prompt assembly with semantic recall, the ReAct loop, the failover
chain, trace extraction. Mention the async brain-fact extraction at the end.

**"How do you handle the LLM being down or rate-limited?"**
→ §5. Round-robin over keys (each key is its own quota), then a different provider,
then a tool-free retry. Emphasize *why* tool-free retry helps: most failures are
malformed tool calls, not outages.

**"How does it remember things about the user?"**
→ §6. Three distinct layers. The good detail: brain-fact extraction runs in a
background thread and still works in privacy mode.

**"What's the biggest security risk in an agent product, and what did you do?"**
→ §1 Idea 2. The risk is irreversible autonomous action. The answer is the
draft-then-human-confirm gate. Then: sandboxed file paths, AST-based calculator
instead of `eval`, per-row ownership checks, write-only key storage.

**"Why LangGraph? Why not just call the API in a loop?"**
→ §3. It provides the ReAct loop as a state graph and normalizes tool-calling across
providers. Note what you *didn't* adopt (no checkpointer) and why.

**"How would this scale to 10,000 users?"**
Honest answer with specifics:
- Rate limiter is in-memory → move to Redis (blocks horizontal scaling *today*)
- Cron passes iterate users serially → needs a real queue (Celery/RQ)
- Chroma is on ephemeral local disk → managed vector DB
- Free Render instance → paid, multi-instance
- Usage counters are a JSON file → a table or Redis

Naming the actual blockers beats claiming it already scales.

**"What was the hardest bug?"**
Two strong options:
- **The Shadow DOM one** (§10.3): the symptom was cosmetic (a white input box), the
  cause was CSS cascade fundamentals, and the fix incidentally solved a second
  problem (detectability) while requiring you to then handle event retargeting.
- **The OAuth scope one** (§8): misleading UI rather than a crash, caused by a
  library reporting requested scopes as granted ones.

**"What would you do differently?"**
- Use Alembic instead of the hand-rolled additive migrations in `database.py` — it
  works but can only add columns, never rename or drop
- Argon2 over PBKDF2
- Redis-backed rate limiting from day one
- The `agentforge` / `AgentFury` naming inconsistency should have been cleaned up
  before it reached protocol handlers and localStorage keys

**"Why three clients?"**
Different jobs. Web is the full experience. Desktop adds a tray icon and background
reminders that fire when the window is closed. The extension puts the assistant where
the work happens — inside Gmail, on any page — where switching tabs to a web app is
exactly the friction that kills usage.

---

## 13. Numbers and names to have ready

| Thing | Value |
|---|---|
| Password hashing | PBKDF2-HMAC-SHA256, 200,000 iterations |
| JWT | HS256, 30-day expiry |
| OAuth state token | Signed JWT, 10-minute expiry |
| ReAct recursion limit | 24 |
| Follow-up suggestion timeout | 2.5 seconds |
| Semantic recall | top-4 (`k=4`) |
| Autopilot batch | 12 fetched, up to 8 acted on |
| Escalation delay | 4 hours |
| Cron cadence | 1 min (reminders), ~15 min (scan) |
| Default model | `openai/gpt-oss-20b` (Groq) |
| Classifier model | `gpt-oss-120b` → `20b` fallback |
| Fast helper model | `llama-3.1-8b-instant` |
| Error log cap | 2000 rows (self-trimming) |

**Key file paths:**
- `backend/app/agents/runtime.py` — the agent loop
- `backend/app/tools/registry.py` — tool resolution
- `backend/app/llm/router.py` — provider routing and key rotation
- `backend/app/brain.py` — fact extraction
- `backend/app/autopilot.py` — the autonomous agent
- `backend/app/security/secret_store.py` — three-backend secret storage
- `extension/content-global.js` — Shadow DOM UI, select-to-ask
- `frontend/src/components/ChatApp.jsx` — the authenticated shell

**Naming gotcha:** the product is **AgentFury**; legacy identifiers say
`agentforge` (localStorage keys, the `agentforge://` protocol, `com.agentforge.app`,
the SQLite filename). If an interviewer notices, the honest answer is "it was renamed
after those identifiers were baked into a protocol handler and stored client state;
changing them now would log everyone out and break existing desktop installs."

---

## 14. Three things to lead with

If you get one open-ended "tell me about your project," these are the highest-signal
points:

1. **"An agent is a database row, not a class."** Shows architectural thinking and
   directly explains the product's core promise.

2. **"The AI can draft an email but not send one."** Shows you thought about safety
   as a design constraint, not a feature.

3. **"I assumed every external dependency would fail."** Then give the concrete
   ladder: key rotation → provider failover → tool-free retry → keyword heuristic.
   Shows production instinct rather than happy-path coding.
