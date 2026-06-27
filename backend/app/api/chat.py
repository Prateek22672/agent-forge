"""
Chat endpoint — the place where a user message becomes an agent run.

Flow:
    1. Find (or create) the conversation.
    2. Load prior messages (short-term memory) from SQLite.
    3. Persist the user's message.
    4. Run the agent (runtime.run_agent).
    5. Persist the assistant reply + the tool trace.
    6. Return reply + trace to the client.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.agents.runtime import run_agent, suggest_followups
from app.auth import get_current_user
from app.database import get_db
from app.models import Agent, Conversation, Message, User
from app.schemas import (
    ChatRequest,
    ChatResponse,
    ConversationOut,
    MessageOut,
)

router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/agents/{agent_id}/chat", response_model=ChatResponse)
def chat(
    agent_id: str,
    payload: ChatRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    agent = db.get(Agent, agent_id)
    if not agent or agent.user_id != user.id:
        raise HTTPException(404, "Agent not found")

    # 1. Resolve conversation.
    if payload.conversation_id:
        convo = db.get(Conversation, payload.conversation_id)
        if not convo or convo.agent_id != agent_id:
            raise HTTPException(404, "Conversation not found")
    else:
        title = payload.message[:60] or "New conversation"
        convo = Conversation(agent_id=agent_id, title=title)
        db.add(convo)
        db.commit()
        db.refresh(convo)

    # 2. Short-term memory: prior messages in this conversation.
    history = list(convo.messages)

    # 3. Persist the user message.
    db.add(Message(conversation_id=convo.id, role="user", content=payload.message))
    db.commit()

    # 4. Run the agent (personalised with the user's tone/about/memory).
    try:
        reply, traces = run_agent(agent, history, payload.message, user)
    except Exception as exc:
        raise HTTPException(500, f"Agent run failed: {exc}")

    # 4b. Suggest next tasks (best-effort; never blocks/breaks the reply).
    suggestions = suggest_followups(payload.message, reply)

    # 5. Persist the assistant reply (with the tool trace in meta).
    db.add(
        Message(
            conversation_id=convo.id,
            role="assistant",
            content=reply,
            meta={"tool_calls": traces, "suggestions": suggestions},
        )
    )
    db.commit()

    return ChatResponse(
        conversation_id=convo.id, reply=reply, tool_calls=traces, suggestions=suggestions
    )


@router.get("/conversations")
def list_all_conversations(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """Every conversation across the user's agents — powers the history sidebar."""
    rows = (
        db.query(Conversation, Agent.name)
        .join(Agent, Conversation.agent_id == Agent.id)
        .filter(Agent.user_id == user.id)
        .order_by(Conversation.created_at.desc())
        .all()
    )
    return [
        {
            "id": c.id,
            "agent_id": c.agent_id,
            "agent_name": agent_name,
            "title": c.title,
            "created_at": c.created_at,
        }
        for c, agent_name in rows
    ]


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a conversation (and its messages) to free space."""
    convo = db.get(Conversation, conversation_id)
    if not convo:
        return
    agent = db.get(Agent, convo.agent_id)
    if not agent or agent.user_id != user.id:
        raise HTTPException(404, "Conversation not found")
    db.delete(convo)
    db.commit()


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
def get_messages(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    convo = db.get(Conversation, conversation_id)
    if not convo:
        raise HTTPException(404, "Conversation not found")
    agent = db.get(Agent, convo.agent_id)
    if not agent or agent.user_id != user.id:
        raise HTTPException(404, "Conversation not found")
    return list(convo.messages)
