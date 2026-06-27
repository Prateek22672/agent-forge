"""
Model router.

Today this returns a Groq chat model (free + extremely fast). The function is
the single seam where you'd later add OpenAI, Anthropic, Gemini, or a local
Ollama model — callers ask for a model by name and never care who serves it.
That is exactly how LiteLLM / model-routing works in production.

LEARNING NOTE — what a "chat model" is:
    A LangChain chat model is an object you call with a list of messages and get
    a message back. Every provider exposes the same interface (`.invoke`,
    `.stream`, `.bind_tools`), so the rest of the app is provider-agnostic.
"""
from __future__ import annotations

from functools import lru_cache

from langchain_groq import ChatGroq

from app.config import settings
from app import runtime_settings

# Friendly catalogue shown in the UI. All are free on Groq's tier.
# NOTE on tool calling: the GPT-OSS and Llama-3.1 models emit well-formed tool
# calls reliably. llama-3.3-70b is strong at prose but occasionally produces a
# malformed tool call that Groq rejects (tool_use_failed) — so it's offered, but
# not the default, and the runtime has a fallback for when any model slips up.
AVAILABLE_MODELS: dict[str, str] = {
    "openai/gpt-oss-20b": "GPT-OSS 20B — reliable tool calls, great all-round (default)",
    "openai/gpt-oss-120b": "GPT-OSS 120B — strongest open-weight, reliable tools",
    "llama-3.1-8b-instant": "Llama 3.1 8B — fastest & cheapest, reliable tools",
    "llama-3.3-70b-versatile": "Llama 3.3 70B — best prose, occasional tool hiccups",
}


import threading

from app import keys as key_manager
from app import usage

# Round-robin over the CURRENT Groq key pool (env + admin-added). Read fresh on
# every call so keys added from the admin panel take effect immediately.
_key_lock = threading.Lock()
_key_idx = 0


def _next_groq_key() -> str:
    global _key_idx
    pool = key_manager.groq_keys() or [settings.groq_api_key]
    with _key_lock:
        key = pool[_key_idx % len(pool)]
        _key_idx += 1
    usage.record("groq", key[-4:] if key else "")
    return key


@lru_cache(maxsize=64)
def _cached_groq(model: str, temperature: float, api_key: str) -> ChatGroq:
    # Cache one client per (model, temperature, key) combination.
    return ChatGroq(
        model=model,
        temperature=temperature,
        api_key=api_key,
        max_retries=2,
    )


@lru_cache(maxsize=8)
def _cached_ollama(model: str, temperature: float):
    # Imported lazily so the app runs even if langchain-ollama isn't present.
    from langchain_ollama import ChatOllama

    return ChatOllama(
        model=model,
        temperature=temperature,
        base_url=settings.ollama_base_url,
    )


@lru_cache(maxsize=8)
def _cached_gemini(model: str, temperature: float, api_key: str):
    # Imported lazily so the app runs even if langchain-google-genai is absent.
    from langchain_google_genai import ChatGoogleGenerativeAI

    return ChatGoogleGenerativeAI(
        model=model,
        temperature=temperature,
        google_api_key=api_key,
    )


def _gemini_key() -> str | None:
    pool = key_manager.gemini_keys()
    return pool[0] if pool else None


def gemini_available() -> bool:
    return bool(_gemini_key())


def get_llm(model: str | None = None, temperature: float = 0.7):
    """Return the PRIMARY chat model for the active provider.

    Provider is chosen at runtime (UI-flippable) via runtime_settings:
      • "groq"   -> cloud, free, fast; round-robins across all Groq keys
      • "gemini" -> Google Gemini (cloud)
      • "ollama" -> a model running locally; nothing leaves the device

    This single function is the seam that makes the app provider-agnostic.
    """
    provider = runtime_settings.get("llm_provider")
    if provider == "ollama":
        return _cached_ollama(runtime_settings.get("ollama_model"), temperature)
    if provider == "gemini":
        gk = _gemini_key()
        if gk:
            usage.record("gemini", gk[-4:])
            return _cached_gemini(settings.gemini_model, temperature, gk)

    # Default: Groq, spreading load across the key pool.
    if not model:
        model = runtime_settings.get("default_model")
    return _cached_groq(model, temperature, _next_groq_key())


def get_fast_groq(temperature: float = 0.4):
    """A small fast Groq model for INTERNAL helpers (e.g. follow-up suggestions),
    independent of the user's selected provider so it stays cheap and reliable."""
    if not key_manager.groq_keys():
        return None
    return _cached_groq("llama-3.1-8b-instant", temperature, _next_groq_key())


def get_failover_llms(temperature: float = 0.7) -> list:
    """Ordered list of ALTERNATE models to retry with when the primary fails.

    Order is chosen for reliability: try fresh Groq keys first (a different
    credential = independent rate-limit quota, same fast model), then overflow to
    Gemini (a different provider, which also rescues model-specific failures like
    a malformed tool call). The runtime tries each in turn until one works."""
    candidates = []
    model = runtime_settings.get("default_model")
    # One alternate per *additional* Groq key (so we don't retry the same key).
    for _ in range(max(0, len(key_manager.groq_keys()) - 1)):
        try:
            candidates.append(_cached_groq(model, temperature, _next_groq_key()))
        except Exception:
            pass
    gk = _gemini_key()
    if gk:
        try:
            usage.record("gemini", gk[-4:])
            candidates.append(_cached_gemini(settings.gemini_model, temperature, gk))
        except Exception:
            pass
    return candidates
