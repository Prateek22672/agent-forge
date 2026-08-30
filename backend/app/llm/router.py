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
# NOTE: Groq deprecated its Llama chat models (llama-3.1-8b-instant and
# llama-3.3-70b-versatile) in mid-2026 — calling them now returns
# model_not_found. The GPT-OSS models are the supported path and emit
# well-formed tool calls reliably, so everything runs on those.
AVAILABLE_MODELS: dict[str, str] = {
    "openai/gpt-oss-20b": "GPT-OSS 20B — reliable tool calls, fast, great all-round (default)",
    "openai/gpt-oss-120b": "GPT-OSS 120B — strongest open-weight, reliable tools",
}


import contextvars
import threading
import time

from app import keys as key_manager
from app import usage

# Round-robin over the CURRENT key pool (env + admin-added), read fresh on
# every call so keys added from the admin panel take effect immediately.
_key_lock = threading.Lock()
_key_idx = 0
_gemini_key_lock = threading.Lock()
_gemini_key_idx = 0


# Which key served the call currently being handled. A ContextVar rather than
# a global: several requests share the process, and blaming a failure on
# whichever key happened to be taken last would be worse than not recording it.
_current_key: contextvars.ContextVar[str] = contextvars.ContextVar("af_current_key", default="")


def last_key_suffix() -> str:
    """The masked suffix of the key that served this request, for metrics."""
    try:
        return _current_key.get()
    except Exception:
        return ""


def _next_groq_key() -> str:
    global _key_idx
    pool = key_manager.groq_keys() or [settings.groq_api_key]
    with _key_lock:
        key = pool[_key_idx % len(pool)]
        _key_idx += 1
    suffix = key[-4:] if key else ""
    usage.record("groq", suffix)
    try:
        _current_key.set(suffix)
    except Exception:
        pass
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
    """Round-robin over the Gemini key pool, same as Groq — previously this
    always returned the first key, so extra Gemini keys added in the admin
    panel never actually got used."""
    global _gemini_key_idx
    pool = key_manager.gemini_keys()
    if not pool:
        return None
    with _gemini_key_lock:
        key = pool[_gemini_key_idx % len(pool)]
        _gemini_key_idx += 1
    try:
        _current_key.set(key[-4:] if key else "")
    except Exception:
        pass
    return key


def gemini_available() -> bool:
    return bool(_gemini_key())


# Groq retired these mid-2026; anything still asking for one (a stale
# default_model setting, an old agent row) is transparently remapped so it
# keeps working instead of 500ing with model_not_found.
_DEPRECATED_MODELS = {
    "llama-3.1-8b-instant": "openai/gpt-oss-20b",
    "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
    "llama3-8b-8192": "openai/gpt-oss-20b",
    "llama3-70b-8192": "openai/gpt-oss-120b",
    "mixtral-8x7b-32768": "openai/gpt-oss-20b",
}


def _norm_model(model: str | None) -> str:
    m = (model or "").strip()
    if not m:
        m = runtime_settings.get("default_model") or "openai/gpt-oss-20b"
    return _DEPRECATED_MODELS.get(m, m)


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
    return _cached_groq(_norm_model(model), temperature, _next_groq_key())


def get_groq(model: str, temperature: float = 0.2):
    """Force a specific Groq model (independent of the provider toggle), rotating
    keys. Used by internal features that need a particular model for accuracy."""
    if not key_manager.groq_keys():
        return None
    return _cached_groq(_norm_model(model), temperature, _next_groq_key())


def get_fast_groq(temperature: float = 0.4):
    """The model behind every INSTANT path — the selection-bar answer, live
    proofreading, email polish, brain-fact extraction, follow-up suggestions —
    independent of the user's provider toggle so it stays cheap and quick.

    Which model that is was measured, not assumed: same prompts, every model
    on the account, twice each. qwen3.8-27b came out fastest (0.51s best vs
    0.73s for gpt-oss-20b) and answered correctly, so it is the default, with
    gpt-oss-20b as the fallback if it ever fails to construct. Flip
    `fast_model` in runtime settings if Groq retires it."""
    if not key_manager.groq_keys():
        return None
    model = runtime_settings.get("fast_model") or settings.fast_model
    try:
        return _cached_groq(model, temperature, _next_groq_key())
    except Exception:
        return _cached_groq("openai/gpt-oss-20b", temperature, _next_groq_key())


def get_vision_llms(temperature: float = 0.2) -> list[tuple[object, str]]:
    """Every chat model available here that can actually LOOK at an image,
    best first, each paired with its provider name — `[(llm, "gemini"), ...]`.

    The provider matters to the caller: LangChain normalizes text, but the
    image block in a message is still provider-shaped (Gemini wants
    `image_url` as a plain data-URI string, Groq/OpenAI want
    `{"url": ...}`), so the API layer needs to know which one it is holding.

    A LIST rather than one model, because these are the two most breakage-prone
    ids in the app — providers retire multimodal models faster than anything
    else (both defaults here had to be replaced once already). If Gemini 404s
    on a stale id, Groq should still answer instead of the feature going dark.

    Order is measured, not assumed: on the same OCR, Groq's qwen3.8 took
    0.75s and Gemini 2.5-6.9s, both reading the image correctly - so Groq
    leads and Gemini is the failover (flash-lite first, at 1.1s, then the
    full flash model). The rest of the app runs on GPT-OSS,
    which is text-only — hence this separate seam rather than get_fast_groq().
    """
    out: list[tuple[object, str]] = []
    if key_manager.groq_keys():
        try:
            model = runtime_settings.get("vision_model") or settings.vision_model
            out.append((_cached_groq(model, temperature, _next_groq_key()), "groq"))
        except Exception:
            pass
    gk = _gemini_key()
    if gk:
        for model in (settings.gemini_vision_model, settings.gemini_model):
            try:
                usage.record("gemini", gk[-4:])
                out.append((_cached_gemini(model, temperature, gk), "gemini"))
            except Exception:
                pass
    return out


_warm_lock = threading.Lock()
_warmed_at = 0.0


def warm_fast_models(min_gap: float = 240.0) -> None:
    """Open a connection to the fast model on every key, in the background.

    Measured, because it was surprising: the same question that takes 0.51s on
    a warm client took 2.24s through the API. None of that gap is generation -
    it is the TLS handshake and client setup a FRESH ChatGroq pays on its
    first call, and the key pool guarantees a fresh one several times over
    (the client cache is keyed by model+temperature+key, so each combination
    is cold once).

    So pay it up front, off the request path: a one-token "ok" per key at
    startup, and again when a sleeping instance is pinged awake. Throttled, so
    the extension's WARM_UP on every page load can call it freely.
    """
    global _warmed_at
    with _warm_lock:
        if time.monotonic() - _warmed_at < min_gap:
            return
        _warmed_at = time.monotonic()

    def _run() -> None:
        model = runtime_settings.get("fast_model") or settings.fast_model
        keys = key_manager.groq_keys()[:4]
        # The temperatures the instant paths actually use: answers 0.3,
        # JSON/proofread 0.0, vision 0.2, polish 0.4.
        for temperature in (0.3, 0.0, 0.2, 0.4):
            for key in keys:
                try:
                    _cached_groq(model, temperature, key).invoke("ok")
                except Exception:
                    pass

    threading.Thread(target=_run, daemon=True, name="af-warm-llm").start()


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
