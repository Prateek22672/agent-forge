"""
The agent runtime — turns a stored Agent (config) into a live, reasoning agent
and runs it for one user turn.

This is where everything comes together:
    config (model + prompt + tools)  ->  a LangGraph ReAct agent  ->  a reply.

WHAT IS A ReAct AGENT? (the single most important concept here)
    "ReAct" = Reason + Act. The loop is:
        1. The model THINKS about the request.
        2. If it needs data/an action, it emits a TOOL CALL (structured JSON
           the model produces because we showed it the tools' schemas).
        3. Our runtime executes that tool and feeds the result back.
        4. Repeat until the model decides it has enough to answer.
    `create_react_agent` from LangGraph builds this loop as a small state graph
    for us — we don't hand-write the while-loop. That's the value LangGraph adds:
    durable, inspectable agent loops with tool execution handled correctly.
"""
from __future__ import annotations

import re

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langgraph.prebuilt import create_react_agent

from app.llm.router import get_failover_llms, get_llm
from app.memory import vector_store
from app.models import Agent, Message
from app.tools.registry import build_tools


def suggest_followups(user_message: str, reply: str) -> list[str]:
    """Generate up to 3 short 'suggested next task' chips for the UI. Best-effort
    and isolated: uses a small fast model and never blocks the main reply — any
    failure just returns no suggestions."""
    try:
        from app.llm.router import get_fast_groq

        llm = get_fast_groq(0.4)
        if llm is None:
            return []
        prompt = (
            "Given the user's message and the assistant's reply, propose exactly 3 "
            "short follow-up actions the user might want next. Each must be a "
            "concise instruction the user could click (max 7 words), phrased as "
            "the USER would type it. Return ONLY the 3 lines, no numbering.\n\n"
            f"User: {user_message}\nAssistant: {reply[:1200]}"
        )
        out = llm.invoke(prompt)
        text = out.content if isinstance(out.content, str) else str(out.content)
        text = _clean_text(text)
        lines = [
            ln.strip(" -•*0123456789.").strip()
            for ln in text.splitlines()
            if ln.strip()
        ]
        return [ln for ln in lines if ln][:3]
    except Exception:
        return []


def _clean_text(text: str) -> str:
    """Strip control-token artifacts that open-weight models (esp. gpt-oss's
    'harmony' format) sometimes leak into their reply content, e.g.
    '<|channel|>', '<|message|>', or a stray 'assistant to=functions...' header.
    Keeps the user-facing answer clean regardless of which model produced it."""
    if not text:
        return text
    # Drop everything from a leaked tool-call header onward.
    text = re.split(r"【?\s*assistant\s+to=functions", text)[0]
    # Remove any remaining <|...|> control tokens.
    text = re.sub(r"<\|[^|>]*\|>", "", text)
    # Remove stray harmony bracket markers.
    text = text.replace("【", "").replace("】", "")
    return text.strip()


def _history_to_messages(history: list[Message]) -> list[BaseMessage]:
    """Convert stored DB messages into LangChain message objects."""
    out: list[BaseMessage] = []
    for m in history:
        if m.role == "user":
            out.append(HumanMessage(content=m.content))
        elif m.role == "assistant":
            out.append(AIMessage(content=m.content))
    return out


_TONE_GUIDE = {
    "friendly": "Warm, encouraging, conversational. Use plain language.",
    "concise": "Brief and to the point. Short sentences, minimal fluff.",
    "professional": "Polished and precise, like a capable colleague.",
    "playful": "Light, witty, and energetic — but still genuinely helpful.",
}


def _build_system_prompt(agent: Agent, user_message: str, user=None) -> str:
    """Compose the system prompt: the agent's own instructions + the USER's
    personalization (tone, about-me) + relevant memories. This is the RAG layer
    that makes every agent feel personal to this specific user."""
    prompt = agent.system_prompt or "You are a helpful assistant."

    # --- Personalization (applies to every agent the user owns) ---
    if user is not None:
        tone = getattr(user, "tone", "friendly") or "friendly"
        guide = _TONE_GUIDE.get(tone, _TONE_GUIDE["friendly"])
        prompt += f"\n\nSpeak in a {tone} tone: {guide}"
        about = (getattr(user, "about", "") or "").strip()
        if about:
            prompt += f"\n\nAbout the user (personalise to this):\n{about}"
        # Cross-agent user memory (facts learned in any of their chats).
        umem = vector_store.recall_user(user.id, user_message, k=4)
        if umem:
            prompt += "\n\nThings you know about this user:\n" + "\n".join(
                f"- {m}" for m in umem
            )

    # Universal guardrail: stop weaker models from looping on search forever.
    tools = agent.tools or []
    if "web_search" in tools:
        prompt += (
            "\n\nTool discipline (IMPORTANT):\n"
            "- Call web_search at most 3 times, and NEVER repeat a near-identical "
            "query. If results are empty twice, STOP searching.\n"
            "- Prefer fetch_url to read one promising result over searching again.\n"
            "- If the request is missing key details (e.g. travel date, origin/"
            "destination, one-way vs round-trip), DON'T guess — ask one short "
            "clarifying question and offer sensible options (e.g. 'today or "
            "tomorrow?', nearest airports/stations) before searching.\n"
            "- If you still can't get live data, answer from your own knowledge "
            "and clearly say it may be out of date. Always give the user something "
            "useful — never reply that you just need more steps."
        )

    if "recall" in tools or "remember" in tools:
        memories = vector_store.recall(agent.id, user_message, k=4)
        if memories:
            joined = "\n".join(f"- {m}" for m in memories)
            prompt += f"\n\nRelevant notes from this agent's memory:\n{joined}"
    return prompt


def run_agent(
    agent: Agent, history: list[Message], user_message: str, user=None
) -> tuple[str, list[dict]]:
    """Run one turn. Returns (reply_text, tool_call_traces)."""
    # 1. Resolve config -> model + tools.
    llm = get_llm(agent.model, agent.temperature)
    tools = build_tools(agent.tools or [], agent.id, agent.user_id)

    # 2. Assemble the conversation: system prompt + prior turns + new message.
    system = SystemMessage(content=_build_system_prompt(agent, user_message, user))
    messages: list[BaseMessage] = [system]
    messages += _history_to_messages(history)
    messages.append(HumanMessage(content=user_message))

    # 3. Run the loop, with cross-provider failover.
    #
    #    RESILIENCE: a provider may rate-limit (429) or a weak model may emit a
    #    malformed tool call (Groq `tool_use_failed`). Instead of 500-ing, we:
    #      a) retry once on the primary (transient errors),
    #      b) rebuild the agent on a DIFFERENT provider/key (Gemini overflow, or
    #         the next Groq key) and retry,
    #      c) as a last resort answer WITHOUT tools so something always returns.
    run_config = {"recursion_limit": 24}  # room to search + synthesize
    result = None
    last_exc: Exception | None = None
    # Try the primary model, then each failover candidate (other Groq keys,
    # then Gemini) until one completes the agent loop.
    for candidate in [llm, *get_failover_llms(agent.temperature)]:
        try:
            result = create_react_agent(candidate, tools).invoke(
                {"messages": messages}, config=run_config
            )
            llm = candidate  # the model that worked (for any synthesis turn)
            break
        except Exception as exc:
            last_exc = exc
            continue

    if result is None:
        # Every provider failed the tool loop — answer without tools as a last
        # resort, again trying each model until one responds.
        for candidate in [llm, *get_failover_llms(agent.temperature)]:
            try:
                fallback = candidate.invoke(
                    messages
                    + [
                        SystemMessage(
                            content=(
                                "Answer directly from your own knowledge. Do not "
                                "call any tools."
                            )
                        )
                    ]
                )
                text = (
                    fallback.content
                    if isinstance(fallback.content, str)
                    else str(fallback.content)
                )
                return _clean_text(text) or "(no response)", []
            except Exception as exc:
                last_exc = exc
                continue
        return (
            f"All model providers are currently unavailable ({last_exc}). "
            "Please try again shortly.",
            [],
        )
    final_messages: list[BaseMessage] = result["messages"]

    # 5. Extract a readable trace of every tool the agent used (for the UI).
    traces = _extract_tool_traces(final_messages)

    # 6. The reply is the content of the last AI message.
    reply = ""
    for m in reversed(final_messages):
        if isinstance(m, AIMessage) and m.content:
            reply = m.content if isinstance(m.content, str) else str(m.content)
            break

    # If the loop ended WITHOUT a usable answer — either empty, or LangGraph's
    # canned "need more steps" message when it hit the step limit — force one
    # final synthesis turn from everything gathered, with tools disabled.
    canned = "need more steps" in reply.lower() or "more steps to process" in reply.lower()
    if not reply.strip() or canned:
        try:
            synth = llm.invoke(
                final_messages
                + [
                    SystemMessage(
                        content=(
                            "Stop using tools. Using ONLY the information already "
                            "gathered above, write the final answer for the user now "
                            "in clean Markdown."
                        )
                    )
                ]
            )
            reply = synth.content if isinstance(synth.content, str) else str(
                synth.content
            )
        except Exception:
            pass

    return _clean_text(reply) or "(no response)", traces


def _extract_tool_traces(messages: list[BaseMessage]) -> list[dict]:
    """Pair each tool call with its output so the UI can show what happened."""
    # Map tool_call_id -> output text from ToolMessages.
    outputs: dict[str, str] = {}
    for m in messages:
        if isinstance(m, ToolMessage):
            outputs[m.tool_call_id] = (
                m.content if isinstance(m.content, str) else str(m.content)
            )

    traces: list[dict] = []
    for m in messages:
        if isinstance(m, AIMessage) and getattr(m, "tool_calls", None):
            for call in m.tool_calls:
                cid = call.get("id", "")
                traces.append(
                    {
                        "tool": call.get("name", ""),
                        "args": call.get("args", {}),
                        "output": outputs.get(cid, "")[:1000],
                    }
                )
    return traces
