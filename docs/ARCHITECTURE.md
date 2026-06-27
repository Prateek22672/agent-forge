# AgentForge — Architecture

This document explains **every component** and **how a request flows through the
system**. Read it alongside the code; file references are given throughout.

---

## 1. The big idea: an agent is *data*, not code

Most tutorials hard-code one agent in Python. AgentForge instead stores an agent
as a **row in a database**:

```
Agent {
  name, description,
  system_prompt,        # its personality + instructions
  tools: ["web_search", "fetch_url"],   # capabilities it may use
  model, temperature
}
```

The **runtime** ([`app/agents/runtime.py`](../backend/app/agents/runtime.py))
reads that row and *constructs a live agent on demand*. This is why users can
create any agent from the UI without anyone writing new code — exactly the
"Wix for AI agents" goal.

---

## 2. Component map

```
                     ┌─────────────────────────────┐
   Browser ────────► │  React + Vite frontend       │
   (localhost:5173)  │  create agents, chat         │
                     └──────────────┬──────────────┘
                                    │  /api/* (JSON, proxied)
                                    ▼
                     ┌─────────────────────────────┐
                     │  FastAPI  (app/main.py)      │
                     │  CORS, routing, lifespan     │
                     └──────────────┬──────────────┘
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
      app/api/agents.py      app/api/chat.py        /api/health
      (CRUD + catalog)       (the agent run)
                                    │
                                    ▼
                     ┌─────────────────────────────┐
                     │  Agent runtime               │
                     │  app/agents/runtime.py       │
                     │  config -> ReAct agent       │
                     └───┬───────────┬───────────┬──┘
                         ▼           ▼           ▼
                  llm/router.py  tools/registry  memory/vector_store
                  (Groq model)   (LangChain      (Chroma semantic
                                  tools)          memory)
                                    │
                                    ▼
                     ┌─────────────────────────────┐
                     │  SQLite (app/database.py)    │
                     │  agents, conversations, msgs │
                     └─────────────────────────────┘
```

---

## 3. End-to-end: what happens when you send a message

Trace through [`app/api/chat.py`](../backend/app/api/chat.py):

1. **HTTP POST** `/api/agents/{id}/chat` with `{ message, conversation_id }`.
2. The endpoint loads the **Agent** row and the **Conversation** (or creates one).
3. It loads prior **Messages** — this conversation's *short-term memory*.
4. It saves the user's message to SQLite.
5. It calls `run_agent(agent, history, message)`:
   - `get_llm(agent.model)` returns a **Groq chat model**
     ([`llm/router.py`](../backend/app/llm/router.py)).
   - `build_tools(agent.tools, agent.id)` resolves the agent's tool names into
     real LangChain tool objects ([`tools/registry.py`](../backend/app/tools/registry.py)).
   - `create_react_agent(llm, tools)` builds a **LangGraph state graph** that
     runs the reason→act→observe loop.
   - Relevant **semantic memories** are recalled and injected into the system
     prompt, so the agent "remembers" the user.
   - `graph.invoke({...})` runs the loop until the model produces a final answer.
6. The runtime extracts a **tool trace** (which tools ran, with what args/outputs).
7. The endpoint saves the assistant reply (+ trace) and returns it.
8. The UI renders the reply and an expandable "tool calls" panel.

---

## 4. The three memory layers

Memory is where most agent products fall over. AgentForge separates three kinds:

| Layer | Lives in | Lifespan | Code |
| --- | --- | --- | --- |
| **Short-term** (this conversation's turns) | SQLite `messages` | one conversation | `api/chat.py` loads history each turn |
| **Structured** (agents, conversations, msgs) | SQLite | forever | `models.py` |
| **Semantic** (facts to recall by *meaning*) | ChromaDB | forever, per-agent | `memory/vector_store.py` |

Semantic memory is what makes an agent feel personal: tell the "Personal
Assistant" agent *"I'm vegetarian"*, it calls the `remember` tool, and weeks
later when you ask for dinner ideas the fact is recalled by similarity and
injected into its prompt — no keyword match required, no API key, all local.

---

## 5. The model seam (swapping/​adding providers)

`llm/router.py` is the **only** file that knows we use Groq. Everything else asks
for "a chat model by name." To add OpenAI / Anthropic / a local Ollama model you
change just this file — the runtime, tools, and API are untouched. That seam is
how production systems do multi-provider routing (e.g. cheap model for simple
tasks, strong model for hard ones).

---

## 6. Tool safety

Tools are the agent's hands, so they're the main risk surface:

- **File tools** ([`tools/files.py`](../backend/app/tools/files.py)) resolve every
  path and reject anything outside `WORKSPACE_DIR` — no `../../` escapes.
- **Calculator** ([`tools/utils.py`](../backend/app/tools/utils.py)) parses an AST
  and evaluates a whitelist of operators — never `eval()`.
- **Email** degrades gracefully to a help message when unconfigured.

When you reach the desktop/automation phase, keep this discipline: every new
capability gets a sandbox and an explicit allow-list. See `docs/ROADMAP.md`.

---

## 7. Why these technologies

| Choice | Reason |
| --- | --- |
| **FastAPI** | Async, typed, auto OpenAPI docs, the Python web standard. |
| **LangGraph** | Production-grade agent loops as state graphs (durable, inspectable) instead of a hand-rolled while-loop. |
| **LangChain core** | Uniform `tool` / chat-model interfaces across every provider. |
| **Groq** | Free, *very* fast inference of strong open models. |
| **ChromaDB** | Embeddings + vector search locally, no key, no server. |
| **SQLite → Postgres** | Zero-config now; same SQLAlchemy code scales to Postgres later. |
| **React + Vite + Tailwind** | Fast, standard, easy to extend. |
