# ⚒ AgentFury

> A platform for creating **personal AI agents** — like a "Wix for AI agents."
> Build an agent (email summariser, web researcher, file organiser, anything),
> give it tools, and chat with it. Runs entirely on **free** infrastructure.

This is the **Phase 1–2 foundation** of the bigger personal-AI-OS vision
(see [`docs/ROADMAP.md`](docs/ROADMAP.md) for all four phases). It is real,
runnable code — not a mockup — designed so the later phases (desktop control,
mobile, marketplace, voice) bolt on cleanly.

---

## What you get today

- **ChatGPT-style UI**: one input + **capability badges** (Web Search, Email, Assistant, or any you create) + a **history sidebar**. Sharp black/white theme.
- **Create any agent** from the UI: name, system prompt, tools, model — each becomes a badge.
- **A real ReAct agent runtime** built on **LangGraph** (reason → call tool → observe → repeat), with anti-loop guards and a synthesis fallback so replies are always **polished Markdown** with cited sources (RAG-grounded).
- **Free tools**: web search (DuckDuckGo), URL reading, file read/write, calculator, datetime, email, and long-term memory.
- **Three layers of memory**: conversation history (SQLite), structured data (SQLite), and **semantic memory** (ChromaDB, local embeddings, no key).
- **Connect Gmail with Google sign-in** (OAuth, read-only, no app password) — top bar shows *"Gmail via Google ✓"*. See [`docs/CONNECT_GOOGLE.md`](docs/CONNECT_GOOGLE.md).
- **Privacy toggle**: run on cloud **Groq** (free/fast) or flip to **local Ollama** so *nothing leaves your device*.
- **Secrets in the OS keychain** (Windows Credential Manager / macOS Keychain), not plaintext.
- **Multi-key load spreading**: add several Groq keys (`GROQ_API_KEYS=`) and the app round-robins across them.
- **🐊 Crocs security**: human-approval gate for email sends, keychain-stored secrets, masked/write-only key management, PBKDF2 passwords, scoped JWTs, per-user isolation, rate limiting, and sanitised output. See [`docs/CROCS_SECURITY.md`](docs/CROCS_SECURITY.md).

### Cost: **$0**

| Concern        | Free choice                                  |
| -------------- | -------------------------------------------- |
| LLM            | **Groq** free tier (Llama 3.3 70B, fast)     |
| Vector DB      | **ChromaDB** (local, built-in embeddings)    |
| Database       | **SQLite** (a single file)                   |
| Web search     | **DuckDuckGo** (no API key)                  |
| Hosting        | Runs on your machine                         |

The **only** thing you need is a free Groq API key.

---

## Quick start

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate     |  macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env        # then edit .env and paste your GROQ_API_KEY
uvicorn app.main:app --reload --port 8000
```

Get a free key at <https://console.groq.com> → API Keys.
API docs auto-generate at <http://localhost:8000/docs>.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Three example agents are seeded automatically.

---

## Documentation (read these — written to teach you)

| Doc | What it covers |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Every component, how a request flows end-to-end, the data model, the memory layers. |
| [`docs/LEARNING.md`](docs/LEARNING.md) | A from-scratch tour of LangChain / LangGraph concepts using **this codebase** as the example: chat models, tools, ReAct agents, embeddings, state graphs. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | The four phases of the full vision and exactly how to extend this foundation toward each. |

---

## Project layout

```
agent/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app + startup seeding
│   │   ├── config.py          # typed settings from .env
│   │   ├── database.py        # SQLAlchemy + SQLite
│   │   ├── models.py          # Agent / Conversation / Message tables
│   │   ├── schemas.py         # Pydantic request/response contracts
│   │   ├── llm/router.py      # model provider seam (Groq today)
│   │   ├── memory/vector_store.py   # semantic memory (Chroma)
│   │   ├── tools/             # the free tool registry
│   │   ├── agents/runtime.py  # config -> LangGraph ReAct agent
│   │   └── api/               # REST endpoints
│   └── requirements.txt
├── frontend/                  # React + Vite + Tailwind
└── docs/                      # architecture, learning, roadmap
```
