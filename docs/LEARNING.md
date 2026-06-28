# Learn LangChain & LangGraph — using *this* codebase

This is a guided tour of the AI concepts behind AgentFury. Every concept points
at the exact file where you can see it working. Read top-to-bottom once, then keep
it open while you explore the code.

---

## 0. Mental model

An "AI agent" is a loop around a language model:

```
        ┌───────────────────────────────────────────┐
        │  while not done:                           │
        │     thought = model.think(messages)        │
        │     if thought wants a tool:               │
        │         result = run_tool(thought.tool)    │
        │         messages.append(result)            │
        │     else:                                  │
        │         done = True                        │
        └───────────────────────────────────────────┘
```

LangChain gives you the *pieces* (models, tools, messages). LangGraph gives you
the *loop* as a robust, inspectable state machine. That's the whole stack.

---

## 1. Messages

LLM chat APIs are message-based. LangChain wraps each role in a class:

- `SystemMessage` — instructions / personality (sent once, first).
- `HumanMessage` — the user.
- `AIMessage` — the model's reply (may contain **tool calls**).
- `ToolMessage` — the result of running a tool, fed back to the model.

See them assembled in
[`app/agents/runtime.py`](../backend/app/agents/runtime.py) → `run_agent`.

---

## 2. Chat models

A chat model is an object with a uniform interface, regardless of provider:

```python
from langchain_groq import ChatGroq
llm = ChatGroq(model="llama-3.3-70b-versatile")
llm.invoke([HumanMessage(content="hi")])      # -> AIMessage
```

Key methods you'll meet:
- `.invoke(messages)` — one call, one reply.
- `.stream(messages)` — token-by-token (used to "type" responses).
- `.bind_tools(tools)` — tell the model which tools exist (LangGraph does this
  for us).

In AgentFury this lives in [`app/llm/router.py`](../backend/app/llm/router.py).
Notice the `get_llm(name)` indirection — that's the seam for multi-provider
routing.

---

## 3. Tools — giving the model hands

A tool is a Python function the model can choose to call. The `@tool` decorator
turns the function's **name + type hints + docstring** into a JSON schema the
model reads:

```python
from langchain_core.tools import tool

@tool
def calculator(expression: str) -> str:
    """Evaluate basic arithmetic. Use this for any math."""
    ...
```

> **The docstring is prompt text.** The model decides *whether* and *how* to call
> a tool purely from its name, parameters, and docstring. Write them for the model.

Real examples to study, simplest first:
- [`tools/utils.py`](../backend/app/tools/utils.py) — calculator, datetime.
- [`tools/web.py`](../backend/app/tools/web.py) — search + page fetch.
- [`tools/files.py`](../backend/app/tools/files.py) — sandboxed file I/O.
- [`tools/registry.py`](../backend/app/tools/registry.py) — how tools are
  catalogued and resolved per agent (including **closures** that capture
  `agent_id` for the memory tools).

---

## 4. The ReAct agent (LangGraph)

**ReAct = Reason + Act.** Instead of writing the loop yourself, LangGraph's
`create_react_agent` builds it:

```python
from langgraph.prebuilt import create_react_agent
graph = create_react_agent(llm, tools)
result = graph.invoke({"messages": [...]})
```

Under the hood this is a small **state graph** with two nodes:

```
   ┌────────┐   tool calls?   ┌────────┐
   │ model  │ ───────────────►│ tools  │
   └────────┘                 └────────┘
        ▲                          │
        └──────── results ─────────┘
   (loops until the model emits a plain answer)
```

- **State** = the running list of messages.
- **Node `model`** = call the LLM.
- **Node `tools`** = execute any tool calls the LLM requested.
- **Edges** = "if the last AI message has tool calls, go to `tools`, else stop."

See it used in [`app/agents/runtime.py`](../backend/app/agents/runtime.py).
We deliberately prepend our own `SystemMessage` and pass full history so the
agent is stateless between turns and we control memory ourselves.

**Why LangGraph over a hand-written loop?** It handles tool-call parsing,
parallel tool calls, errors, and (when you want it) persistence/checkpointing and
streaming — the unglamorous correctness work that bites you in production.

---

## 5. Embeddings & semantic memory

A language model is great at *reasoning* but forgets everything between calls.
**Embeddings** fix recall: text → a vector of numbers where *similar meanings sit
close together*. Store vectors in a **vector database**; later, embed a query and
find the nearest stored vectors = "search by meaning."

```
"I'm vegetarian"  ─embed─►  [0.12, -0.04, ...]   ┐
"book me a steak" ─embed─►  [ ...far away... ]    ├─ Chroma finds the closest
"dinner ideas?"   ─embed─►  [0.11, -0.05, ...] ◄──┘  to the query
```

[`app/memory/vector_store.py`](../backend/app/memory/vector_store.py) uses
**ChromaDB**, whose built-in `all-MiniLM` model creates the embeddings locally —
free, no API key. The runtime calls `recall()` each turn and injects matches into
the system prompt (see `_build_system_prompt`). This is **RAG**
(Retrieval-Augmented Generation) in miniature.

---

## 6. Putting it together — one chat turn

1. `api/chat.py` loads the agent config + conversation history.
2. `runtime.run_agent`:
   - builds the Groq model and the agent's tools,
   - recalls relevant memories → system prompt,
   - `create_react_agent(...).invoke(messages)` runs the ReAct loop,
   - extracts the reply + a trace of tool calls.
3. The reply and trace are saved and returned; the UI shows both.

You now understand: **messages → chat model → tools → ReAct loop → embeddings/
memory → API**. That is 90% of practical "AI engineering."

---

## 7. Where to go next (suggested experiments)

1. **Add a tool.** Write `weather(city)` in a new file, register it in
   `tools/registry.py`, tick it on an agent. Watch the trace call it.
2. **Stream responses.** Swap `graph.invoke` for `graph.stream` and push tokens
   over a WebSocket so replies "type out."
3. **Add a provider.** Add `ChatOpenAI` to `llm/router.py` behind a model name —
   nothing else changes.
4. **Multi-agent.** Let one agent call another as a tool (a "planner" that
   delegates to a "researcher"). This is the CrewAI/orchestration idea, and
   LangGraph models it as a bigger graph.

Concepts you've now met, by name, to read more about:
`chat model`, `tool / function calling`, `ReAct`, `state graph`, `embeddings`,
`vector database`, `RAG`, `system prompt`, `temperature`, `checkpointer`.
