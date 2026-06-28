# AgentFury — Backend, Database & Auth Stack

A precise reference for **what we're actually running**, why each piece was
chosen, and where it lives in the code. Read this with the files open.

---

## 1. Backend stack (at a glance)

| Layer | Technology | Version | Where | Why |
| --- | --- | --- | --- | --- |
| Web framework | **FastAPI** | 0.115 | `app/main.py`, `app/api/*` | Async, typed, auto OpenAPI docs at `/docs` |
| ASGI server | **Uvicorn** | 0.34 | run command | Standard fast ASGI server |
| Validation / schemas | **Pydantic v2** + **pydantic-settings** | 2.10 / 2.7 | `app/schemas.py`, `app/config.py` | Request/response contracts + typed env config |
| ORM | **SQLAlchemy 2.0** | 2.0.36 | `app/database.py`, `app/models.py` | Mature ORM; same code scales SQLite → Postgres |
| Database | **SQLite** (file) | stdlib | `backend/data/agentforge_v2.sqlite3` | Zero-setup, single file, free |
| Agent runtime | **LangGraph** + **LangChain core** | 0.2.62 / 0.3 | `app/agents/runtime.py` | Production ReAct agent loop as a state graph |
| LLM providers | **Groq**, **Gemini**, **Ollama** | via langchain-* | `app/llm/router.py` | Free/fast cloud + private local; round-robin + failover |
| Vector memory | **ChromaDB** | 0.5.23 | `app/memory/vector_store.py` | Local embeddings, no API key — semantic memory |
| Auth tokens | **PyJWT** | 2.10 | `app/auth.py` | Stateless HS256 sessions |
| Password hashing | **hashlib.pbkdf2** | stdlib | `app/auth.py` | Salted, no native dependency |
| Secret storage | **keyring** | 25.6 | `app/security/secret_store.py` | OS keychain for OAuth tokens |
| Google / Gmail | google-auth, google-auth-oauthlib, google-api-python-client | — | `app/integrations/google_oauth.py` | Sign-in + read-only Gmail |
| Tools | ddgs (DuckDuckGo), httpx, beautifulsoup4 | — | `app/tools/*` | Free web search + page fetch |

**Run:** `uvicorn app.main:app --reload --port 8000` → docs at <http://localhost:8000/docs>.

---

## 2. Database — what it is and what's in it

**Engine:** SQLite, a single file at `backend/data/agentforge_v2.sqlite3`.
(The `_v2` suffix marks the multi-user schema; bumping the filename is how we
"migrate" cleanly in dev — see `app/config.py → db_path`.)

**Access:** SQLAlchemy 2.0 ORM. The engine/session live in
[`app/database.py`](../backend/app/database.py); FastAPI hands each request a
session via the `get_db` dependency.

### Tables (defined in [`app/models.py`](../backend/app/models.py))

```
users                      ← an account
 ├─ id (uuid, pk)
 ├─ email (unique)
 ├─ name
 ├─ password_hash          ← pbkdf2 string; random for Google-only accounts
 └─ created_at

agents                     ← an agent = pure config (becomes a UI badge)
 ├─ id (uuid, pk)
 ├─ user_id  → users.id    ← OWNERSHIP: every agent belongs to a user
 ├─ name, description
 ├─ system_prompt          ← personality + instructions
 ├─ tools (JSON list)      ← which capabilities it may use
 ├─ model, temperature
 └─ created_at

conversations              ← a chat thread with one agent
 ├─ id (uuid, pk)
 ├─ agent_id → agents.id
 ├─ title
 └─ created_at

messages                   ← one turn in a conversation
 ├─ id (uuid, pk)
 ├─ conversation_id → conversations.id
 ├─ role  (user|assistant)
 ├─ content
 ├─ meta (JSON)            ← tool-call trace for the UI
 └─ created_at

connections                ← a linked external account (Google)
 ├─ id (uuid, pk)
 ├─ user_id → users.id     ← per-user (this is why multiple Gmails work)
 ├─ provider ("google")
 ├─ account_email          ← shown in the "✓ Gmail — …" badge
 ├─ status, scopes (JSON)
 └─ connected_at
```

**Key design point — everything is owned by a user.** Agents, conversations
(via their agent), and connections all carry / reach a `user_id`. Every query
filters by the authenticated user, so accounts are fully isolated. That is what
makes "different users, different Gmail inboxes" work.

### What is NOT in the SQL database (on purpose)

| Data | Where it lives instead | Why |
| --- | --- | --- |
| OAuth tokens (Gmail) | **OS keychain** (`keyring`) | Secrets shouldn't sit in the DB; encrypted by the OS |
| Semantic memories | **ChromaDB** (`data/chroma/`) | Vector store, searched by meaning |
| JWT signing secret | `data/auth_secret.txt` (generated once) | Signs/verifies tokens |
| Runtime settings (model provider) | `data/runtime_settings.json` | UI-flippable without code/DB changes |

---

## 3. Auth — how identity & sessions work

Two ways to sign in, both ending in the **same JWT session**.

### A) Email + password
- **Signup** (`POST /api/auth/signup`): hash the password with
  **PBKDF2-HMAC-SHA256** (200k iterations, random salt — `app/auth.py`),
  create the `users` row, seed 3 starter agents, return a JWT.
- **Login** (`POST /api/auth/login`): verify the password against the stored
  hash (constant-time compare), return a JWT.
- Passwords are **never stored in plaintext** and never logged.

### B) Sign in with Google (one consent does everything)
- `GET /api/auth/google/start` (public) builds a Google consent URL requesting
  **openid + email + profile + gmail.readonly**, with a signed `state` marking
  a `login` flow.
- User consents → Google redirects to
  `GET /api/connections/google/callback`.
- The callback (`app/api/connections.py`) exchanges the code, reads the Google
  profile, **finds-or-creates** the `users` row by email, **stores the Gmail
  token in the keychain**, records the `connections` row, mints a JWT, and
  redirects back to the app with it. → You're logged in *and* Gmail is connected
  in a single step.

### The JWT session
- Format: **HS256 JWT**, payload `{ sub: user_id, exp }`, 30-day expiry.
- Signed with a secret generated once and stored in `data/auth_secret.txt`.
- The browser keeps the token in `localStorage` and sends it as
  `Authorization: Bearer <token>` on every request (frontend `src/api.js`).
- Backend dependency **`get_current_user`** (`app/auth.py`) decodes the token,
  loads the `User`, and injects it into each protected endpoint. No valid token
  → `401`, and the frontend bounces to the landing page.

### Two OAuth "flows", one callback
The signed `state` parameter tells the shared callback what to do:
- `{login: true}`  → sign-in-with-Google (create/find account, issue token).
- `{uid: <id>}`    → an already-logged-in user **connecting** Gmail.

`state` is a short-lived (10 min) signed token, so it can't be forged or replayed.

---

## 4. How a request flows (end to end)

```
Browser (React, localStorage token)
   │  Authorization: Bearer <jwt>
   ▼
FastAPI  app/main.py  ──► CORS, routing
   │
   ├─ get_db  (SQLAlchemy session)          app/database.py
   ├─ get_current_user  (decode JWT)        app/auth.py
   ▼
Endpoint  app/api/*.py   (filters by user.id)
   │   e.g. POST /api/agents/{id}/chat
   ▼
Agent runtime  app/agents/runtime.py
   ├─ get_llm()         → Groq / Gemini / Ollama   app/llm/router.py
   ├─ build_tools()     → web/files/email/memory    app/tools/*
   ├─ recall memories   → ChromaDB                   app/memory/*
   └─ create_react_agent(...).invoke(...)            LangGraph
   ▼
Persist messages → SQLite ; reply + tool trace → Browser
```

---

## 5. Scaling later (when you outgrow SQLite)

Because everything goes through SQLAlchemy, moving to **PostgreSQL** is a
connection-string change in `app/database.py` (plus running Postgres — see the
sketch in `docker-compose.yml`). The ORM models, queries, auth, and API are
unchanged. Vector memory can stay on Chroma or move to `pgvector`/Qdrant. See
[`ROADMAP.md`](ROADMAP.md) for the full path.

---

## 6. One-line summary

> **FastAPI + SQLAlchemy/SQLite backend; JWT sessions (PyJWT) with PBKDF2
> passwords and Sign-in-with-Google; per-user data isolation; LangGraph agent
> runtime over Groq/Gemini/Ollama; ChromaDB semantic memory; secrets in the OS
> keychain.**
