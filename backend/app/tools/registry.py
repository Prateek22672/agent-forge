"""
The tool registry — the catalogue of capabilities an agent can be given.

Two kinds of tools live here:
  • STATIC tools   — plain functions, the same for every agent (search, files…).
  • PER-AGENT tools — built fresh per agent because they need the agent's id
                      (the semantic-memory tools `remember` / `recall`).

`build_tools(names, agent_id)` turns a list of tool names (stored on the Agent
row) into the actual LangChain tool objects the runtime binds to the model.
"""
from __future__ import annotations

from langchain_core.tools import StructuredTool, tool

from app.memory import vector_store
from app.tools.calendar_tool import make_calendar_tool
from app.tools.email_tool import make_email_tool, make_send_email_tool
from app.tools.tasks import make_task_tools
from app.tools.files import list_files, read_file, write_file
from app.tools.utils import calculator, current_datetime
from app.tools.web import fetch_url, web_search

# name -> (tool_object, human description, needs external config?)
# "fetch_recent_emails" is per-user (built in build_tools), so it's catalogued
# separately below rather than living in STATIC_TOOLS.
STATIC_TOOLS: dict[str, tuple] = {
    "web_search": (web_search, "Search the web (DuckDuckGo)", False),
    "fetch_url": (fetch_url, "Read the text of a web page", False),
    "calculator": (calculator, "Do exact arithmetic", False),
    "current_datetime": (current_datetime, "Get the current UTC date/time", False),
    "list_files": (list_files, "List files in the workspace", False),
    "read_file": (read_file, "Read a workspace file", False),
    "write_file": (write_file, "Write a workspace file", False),
}

# Per-user tools (need the user id; built dynamically in build_tools).
USER_TOOLS = {
    "fetch_recent_emails": "Read recent inbox emails (your connected Gmail)",
    "draft_email": "Draft an email to send (you confirm before it sends)",
    "add_calendar_event": "Add an event to your Google Calendar",
}

# Per-user task tools (reminders & notes), built dynamically too.
TASK_TOOLS = {
    "create_reminder": "Save a reminder to your Reminders page",
    "list_reminders": "List your pending reminders",
    "create_note": "Save a note to your Notes page",
}

# Per-agent tool names (built dynamically in build_tools).
MEMORY_TOOLS = {
    "remember": "Save a fact to long-term memory",
    "recall": "Search long-term memory",
}


def catalog() -> list[dict]:
    """Everything the UI needs to render the tool picker."""
    items = [
        {"name": name, "description": desc, "requires_config": cfg}
        for name, (_, desc, cfg) in STATIC_TOOLS.items()
    ]
    items += [
        {"name": name, "description": desc, "requires_config": True}
        for name, desc in USER_TOOLS.items()
    ]
    items += [
        {"name": name, "description": desc, "requires_config": False}
        for name, desc in {**TASK_TOOLS, **MEMORY_TOOLS}.items()
    ]
    return items


def _save_brain_fact(user_id: str, fact: str) -> None:
    """Mirror a fact into the user's vector memory AND the Brain table (so it's
    both recallable by the AI and visible/manageable on the Brain page)."""
    vector_store.remember_user(user_id, fact)
    from app.database import SessionLocal
    from app.models import BrainFact

    db = SessionLocal()
    try:
        db.add(BrainFact(user_id=user_id, text=fact))
        db.commit()
    finally:
        db.close()


def _make_memory_tools(agent_id: str, user_id: str) -> list:
    @tool
    def remember(fact: str) -> str:
        """Save an important fact about the user (names, emails, preferences,
        context) to long-term memory / your brain, so you can recall it later
        instead of re-asking. Use this whenever the user shares something durable."""
        vector_store.remember(agent_id, fact)
        if user_id:
            _save_brain_fact(user_id, fact)
        return "Saved to your brain."

    @tool
    def recall(query: str) -> str:
        """Search your long-term memory for facts relevant to the query."""
        hits = vector_store.recall(agent_id, query)
        return "\n".join(f"- {h}" for h in hits) if hits else "No relevant memories."

    return [remember, recall]


def build_tools(names: list[str], agent_id: str, user_id: str) -> list:
    """Resolve a list of tool names into live LangChain tools for one agent.
    Per-user tools (email) and per-agent tools (memory) are built dynamically."""
    tools: list = []
    want_memory = False
    task_tools = {t.name: t for t in make_task_tools(user_id)} if user_id else {}
    for name in names:
        if name in STATIC_TOOLS:
            tools.append(STATIC_TOOLS[name][0])
        elif name == "fetch_recent_emails":
            tools.append(make_email_tool(user_id))
        elif name == "draft_email":
            tools.append(make_send_email_tool(user_id))
        elif name == "add_calendar_event":
            tools.append(make_calendar_tool(user_id))
        elif name in TASK_TOOLS and name in task_tools:
            tools.append(task_tools[name])
        elif name in MEMORY_TOOLS:
            want_memory = True
    if want_memory:
        # Only add the memory tools that were actually requested.
        mem = {t.name: t for t in _make_memory_tools(agent_id, user_id)}
        for name in names:
            if name in MEMORY_TOOLS:
                tools.append(mem[name])
    return tools
