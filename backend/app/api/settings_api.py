"""
Settings API — read and change runtime settings (the Groq ⇄ local model toggle).

These are UI-flippable and persist to data/runtime_settings.json. Switching to
"ollama" means inference happens locally and no data leaves the device — the
privacy mode.
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app import runtime_settings
from app.config import settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    llm_provider: str | None = None   # "groq" | "ollama"
    ollama_model: str | None = None
    default_model: str | None = None


@router.get("")
def get_settings():
    data = runtime_settings.all_settings()
    return {
        **data,
        "groq_configured": bool(settings.groq_api_key),
        "groq_key_count": len(settings.groq_key_pool),
        "gemini_configured": bool(settings.gemini_api_key),
        "providers": ["groq", "gemini", "ollama"],
    }


@router.put("")
def update_settings(payload: SettingsUpdate):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    return runtime_settings.set_many(updates)
