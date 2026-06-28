# Roadmap — from this foundation to the full personal-AI-OS

AgentFury today implements **Phase 1–2** of the vision. This document shows the
four phases and, crucially, **how each one bolts onto the existing code** so the
architecture you have now is the right starting point.

---

## Phase 1 — Personal Agent Platform ✅ (built)

- [x] Create/edit/delete agents from a UI (agent = config).
- [x] LangGraph ReAct runtime.
- [x] Free tools: web search, URL fetch, files, calculator, datetime, email.
- [x] Three memory layers (conversation, structured, semantic).
- [x] Tool-call trace visible in the UI.
- [x] Runs entirely free (Groq + Chroma + SQLite + DuckDuckGo).

## Phase 2 — Connected accounts (mostly built; OAuth pending) 🔶

- [x] Email via IMAP app-password.
- [ ] **OAuth connectors** for Gmail, Google Calendar, GitHub, Slack.
  - *How:* add an `app/integrations/` package; store per-user tokens in a new
    `connections` table; each integration exposes tools registered in
    `tools/registry.py` exactly like today's tools. Use a free auth layer
    (Authlib, or Clerk/Better-Auth free tier).
- [ ] **Per-user accounts.** Add a `User` model + JWT auth; scope agents and
    memory by `user_id`. The data model already isolates agents, so this is
    additive.

## Phase 3 — Orchestration, automation & marketplace 🔲

- [ ] **Multi-agent orchestration.** A planner agent that delegates to
    specialists. *How:* expose an agent as a tool (`run_agent` already returns a
    string), or grow the LangGraph into a multi-node supervisor graph.
- [ ] **Scheduled / triggered automations.** "Every Friday summarise my GitHub."
    *How:* add **Celery + Redis** (free, self-hosted) for a task queue and a
    `schedules` table; a worker calls the same `run_agent`. The README's stack
    already anticipates this.
- [ ] **Agent marketplace.** Agents are already JSON config — export/import them,
    add a `shared` flag and a gallery page. No runtime changes needed.
- [ ] **Human-approval levels.** Add a `requires_approval` flag per tool; pause
    the graph (LangGraph supports interrupts) until the user confirms.

## Phase 4 — Device control, voice & mobile 🔲

- [ ] **Desktop control.** Wrap the backend in **Electron** (or Tauri) so an
    agent can open apps, manage files beyond the sandbox (with consent), and run
    terminal commands. Add tools `run_command`, `open_app` — *with the same
    sandbox/allow-list discipline as `tools/files.py`*.
- [ ] **Browser automation.** Add **Playwright** tools (`browser_goto`,
    `browser_click`, `browser_fill`) for agents that log in and complete web
    tasks (the MultiOn idea).
- [ ] **Voice.** Whisper (free, local) for speech-to-text + a TTS model;
    optionally LiveKit/OpenAI Realtime for live conversation.
- [ ] **Mobile companion.** A React Native client hitting the same REST API.

---

## Scaling the database

Today: `sqlite:///data/agentforge.sqlite3`. For production multi-user load,
change **one line** in `app/database.py` to a Postgres URL and add `pgvector` (or
keep Chroma). All ORM code is unchanged. Run Postgres + Redis free via Docker:

```yaml
# docker-compose.yml (sketch for Phase 3+)
services:
  db:    { image: postgres:16,  environment: { POSTGRES_PASSWORD: dev } }
  redis: { image: redis:7 }
```

## Free-tier cheat sheet

| Need | Free option |
| --- | --- |
| LLM | Groq, Google AI Studio (Gemini), Ollama (local) |
| Embeddings | Chroma built-in, `sentence-transformers` (local) |
| Vector DB | Chroma, pgvector, Qdrant (self-host) |
| DB / queue | SQLite/Postgres, Redis (self-host) |
| Auth | Authlib, Better-Auth, Clerk free tier |
| Search | DuckDuckGo (no key) |
| Browser | Playwright (open source) |
| Voice | Whisper + Piper/Coqui TTS (local) |

The guiding principle: **every box in the architecture has a $0 option**, so the
whole platform can run for free until you choose to scale.
