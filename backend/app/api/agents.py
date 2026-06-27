"""CRUD endpoints for agents (scoped to the authenticated user), plus the tool
catalogue and model list (which are global)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.llm.router import AVAILABLE_MODELS
from app.memory import vector_store
from app.models import Agent, User
from app.schemas import AgentCreate, AgentOut, AgentUpdate, ToolInfo
from app.tools.registry import catalog

router = APIRouter(prefix="/api", tags=["agents"])


@router.get("/tools", response_model=list[ToolInfo])
def list_tools():
    """Every capability an agent can be granted (for the UI's tool picker)."""
    return catalog()


@router.get("/models")
def list_models():
    """Free Groq models available to assign to an agent."""
    return [{"id": k, "label": v} for k, v in AVAILABLE_MODELS.items()]


@router.get("/agents", response_model=list[AgentOut])
def list_agents(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(Agent)
        .filter(Agent.user_id == user.id)
        .order_by(Agent.created_at.desc())
        .all()
    )


@router.post("/agents", response_model=AgentOut, status_code=201)
def create_agent(
    payload: AgentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    agent = Agent(user_id=user.id, **payload.model_dump())
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


def _owned(db: Session, agent_id: str, user: User) -> Agent:
    agent = db.get(Agent, agent_id)
    if not agent or agent.user_id != user.id:
        raise HTTPException(404, "Agent not found")
    return agent


@router.get("/agents/{agent_id}", response_model=AgentOut)
def get_agent(
    agent_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _owned(db, agent_id, user)


@router.patch("/agents/{agent_id}", response_model=AgentOut)
def update_agent(
    agent_id: str,
    payload: AgentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    agent = _owned(db, agent_id, user)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(agent, key, value)
    db.commit()
    db.refresh(agent)
    return agent


@router.delete("/agents/{agent_id}", status_code=204)
def delete_agent(
    agent_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    agent = _owned(db, agent_id, user)
    db.delete(agent)
    db.commit()
    vector_store.forget_all(agent_id)
