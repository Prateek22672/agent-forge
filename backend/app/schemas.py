"""
Pydantic schemas — the API's request/response contracts.

ORM models = how data is stored. Schemas = how data crosses the HTTP boundary.
Keeping them separate means you can change the database without breaking clients
(and vice-versa).
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# ---------- Auth ----------
class SignupRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=200)
    password: str = Field(..., min_length=6, max_length=200)
    name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    name: str
    is_admin: bool = False
    tone: str = "friendly"
    about: str = ""
    save_history: bool = True
    priority_scan_freq: str = "off"


class ProfileUpdate(BaseModel):
    name: str | None = None
    tone: str | None = None       # friendly | concise | professional | playful
    about: str | None = None      # free-text "about me" for personalization
    save_history: bool | None = None
    priority_scan_freq: str | None = None  # off | 1h | 5h | morning | night | morning_night
    tz_offset_min: int | None = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- Agents ----------
class AgentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = ""
    system_prompt: str = "You are a helpful assistant."
    tools: list[str] = Field(default_factory=list)
    model: str = ""
    temperature: float = 0.7


class AgentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    tools: list[str] | None = None
    model: str | None = None
    temperature: float | None = None


class AgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str
    system_prompt: str
    tools: list[str]
    model: str
    temperature: float
    created_at: datetime


# ---------- Tools ----------
class ToolInfo(BaseModel):
    name: str
    description: str
    requires_config: bool = False


# ---------- Chat ----------
class ChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None  # None -> start a new conversation


class ToolCallTrace(BaseModel):
    tool: str
    args: dict
    output: str


class ChatResponse(BaseModel):
    conversation_id: str
    reply: str
    tool_calls: list[ToolCallTrace] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)  # suggested next tasks


# ---------- Conversations ----------
class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    role: str
    content: str
    meta: dict
    created_at: datetime


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    agent_id: str
    title: str
    created_at: datetime


# ---------- Reminders & Notes ----------
class ReminderCreate(BaseModel):
    title: str
    remind_at: str = ""
    alarm: bool = False


class ReminderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    remind_at: str
    due_at: str = ""
    notified: bool = False
    alarm: bool = False
    status: str
    created_at: datetime


class NoteCreate(BaseModel):
    title: str = ""
    content: str = ""


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    content: str
    created_at: datetime


class EmailDraftOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    to_addr: str
    subject: str
    body: str
    status: str
    created_at: datetime


class PriorityEmailOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    sender: str
    subject: str
    snippet: str
    category: str
    reason: str
    created_at: datetime


class BrainFactCreate(BaseModel):
    text: str


class BrainFactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    text: str
    created_at: datetime
