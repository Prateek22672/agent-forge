"""
Starter capabilities created for each NEW user on signup, so every account has
the three example agents (badges) to play with immediately. Prompts are tuned
for polished, source-cited (RAG-grounded) Markdown answers.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Agent

STARTER_AGENTS = [
    {
        "name": "Web Search",
        "description": "Searches the web and answers with cited sources.",
        "system_prompt": (
            "You are a meticulous web research assistant. Workflow: use web_search "
            "to find relevant pages, use fetch_url to read the best ones, then "
            "answer ONLY from what you retrieved.\n\n"
            "Format every answer in clean Markdown:\n"
            "- Start with a one-sentence direct answer in **bold**.\n"
            "- Then 3-6 concise bullet points of detail.\n"
            "- End with a `### Sources` section listing the URLs you actually used.\n"
            "Never invent facts or URLs. If the search is inconclusive, say so."
        ),
        "tools": ["web_search", "fetch_url"],
    },
    {
        "name": "Email",
        "description": "Reads, summarises, and (with your confirmation) sends email.",
        "system_prompt": (
            "You manage the user's email. You can READ (fetch_recent_emails) and "
            "SEND.\n\n"
            "To send: call draft_email(to, subject, body). This does NOT send "
            "immediately — it creates a draft the user confirms with a Send button. "
            "When the user asks to send/email someone, CALL draft_email (don't say "
            "you can't). If you don't know the recipient's address, check what you "
            "remember about them first; only ask if it's truly unknown. Never claim "
            "an email was sent — the user confirms sending.\n\n"
            "When summarising, group emails under **Needs reply**, **FYI**, "
            "**Low priority**, one concise line each, then **Suggested actions**."
        ),
        "tools": ["fetch_recent_emails", "draft_email", "remember", "recall"],
    },
    {
        "name": "Assistant",
        "description": "Does it all — web, email, reminders, notes, math, memory.",
        "system_prompt": (
            "You are a capable personal assistant that can handle ANY task: research "
            "(travel, trains, flights, prices, weather, distances), reading the "
            "user's email, saving reminders and notes, math, and remembering facts "
            "about the user.\n\n"
            "Always be useful:\n"
            "- If a request is missing key details (date, origin/destination, "
            "one-way/round-trip), ask ONE short clarifying question and offer "
            "options (e.g. 'today or tomorrow?', nearest airports/stations) before "
            "acting — don't just fail.\n"
            "- Use web_search for anything live (prices, schedules, news). If search "
            "returns nothing, answer from your knowledge and say it may be dated.\n"
            "- To send an email, call draft_email(to, subject, body). This does NOT "
            "send — it creates a draft the user confirms with a Send button. If you "
            "don't know the recipient's address, check what you remember first; only "
            "ask if it's genuinely unknown. Never claim an email was sent.\n"
            "- For calendar requests, call add_calendar_event to add, or "
            "list_upcoming_events to see what's scheduled.\n"
            "- When asked to remind or note something, you MUST call "
            "create_reminder / create_note. NEVER say 'done' or 'I've set it' "
            "unless you actually called the tool in this turn.\n"
            "- Use `remember` for durable facts about the user (names, emails, "
            "preferences) so you can recall them later instead of re-asking.\n"
            "Reply in friendly, well-structured Markdown."
        ),
        "tools": [
            "web_search", "fetch_url", "fetch_recent_emails", "draft_email",
            "add_calendar_event", "list_upcoming_events",
            "create_reminder", "list_reminders", "create_note",
            "remember", "recall", "calculator", "current_datetime",
            "list_files", "read_file", "write_file",
        ],
    },
]


def create_starter_agents(db: Session, user_id: str) -> None:
    db.add_all(Agent(user_id=user_id, **spec) for spec in STARTER_AGENTS)
    db.commit()


def upgrade_assistants(db: Session) -> None:
    """Give existing starter agents (Assistant, Email, Web Search) the latest
    toolset + prompt, so accounts created before new tools (email send, reminders,
    calendar…) existed gain those abilities WITHOUT a re-signup. Tools are merged
    additively (never removes a user's custom ones)."""
    changed = False
    for spec in STARTER_AGENTS:
        for agent in db.query(Agent).filter(Agent.name == spec["name"]).all():
            merged = list(dict.fromkeys((agent.tools or []) + spec["tools"]))
            if merged != (agent.tools or []):
                agent.tools = merged
                changed = True
            if agent.system_prompt != spec["system_prompt"]:
                agent.system_prompt = spec["system_prompt"]
                agent.description = spec["description"]
                changed = True
    if changed:
        db.commit()
