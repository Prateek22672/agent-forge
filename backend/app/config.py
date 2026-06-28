"""
Central configuration.

We use pydantic-settings so that every value can come from the environment
(or a .env file) with sane defaults. Import `settings` anywhere you need config.

WHY THIS MATTERS (learning note):
    A production app never hard-codes secrets or paths. By funnelling all
    configuration through one typed object, you get validation for free and a
    single place to look when something is misconfigured.
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


# The backend/ directory (this file is backend/app/config.py -> parents[1] = backend/)
BASE_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    # --- LLM ---
    groq_api_key: str = ""
    # Optional extra keys (comma-separated) to spread rate limits across keys.
    # e.g. GROQ_API_KEYS=gsk_aaa,gsk_bbb,gsk_ccc
    groq_api_keys: str = ""
    default_model: str = "openai/gpt-oss-20b"

    # --- Email tool (optional IMAP fallback) ---
    email_imap_host: str = "imap.gmail.com"
    email_address: str = ""
    email_app_password: str = ""

    # --- Google OAuth (sign-in for Gmail instead of an app password) ---
    google_client_id: str = ""
    google_client_secret: str = ""
    oauth_redirect_uri: str = "http://localhost:8000/api/connections/google/callback"
    # Whether to request the RESTRICTED Gmail/Calendar scopes. Set False for a
    # public beta to avoid Google's "unverified app" warning + verification: the
    # app then only asks for login (email/profile), and Gmail/Calendar features
    # are gated until you complete Google verification. See docs/GOOGLE_VERIFICATION.md
    google_data_scopes: bool = True

    # --- Admin console (separate /admin login) ---
    admin_username: str = "dj"
    admin_password: str = "dj"

    # --- Web Push (PWA notifications) ---
    vapid_public_key: str = ""
    vapid_private_key: str = ""          # PEM (\n-escaped is fine)
    vapid_subject: str = "mailto:admin@agentforge.app"
    cron_secret: str = ""                # protects /api/cron/* (set on Render)

    # --- LLM provider toggle: "groq" (cloud) | "gemini" | "ollama" (local) ---
    llm_provider: str = "groq"
    ollama_model: str = "llama3.2"
    ollama_base_url: str = "http://localhost:11434"

    # --- Gemini (Google AI Studio) — used as cloud overflow/failover ---
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"

    # --- Paths ---
    workspace_dir: str = "./data/workspace"

    # --- CORS ---
    frontend_origin: str = "http://localhost:5173"

    # --- Cloud deploy (optional; local dev ignores these) ---
    # When set, the app uses Postgres + an encrypted DB secret store instead of
    # SQLite + the OS keychain. Render provides DATABASE_URL automatically.
    database_url: str = ""
    # A stable secret for signing JWTs and encrypting DB secrets. MUST be set in
    # the cloud (Render env) so tokens/secrets survive restarts. Local dev falls
    # back to a generated file.
    secret_key: str = ""

    @property
    def is_cloud(self) -> bool:
        return bool(self.database_url)

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---- Derived / helper paths ----
    @property
    def data_dir(self) -> Path:
        # Packaged desktop app sets AGENTFURY_DATA_DIR to a user-writable folder
        # (e.g. %APPDATA%/AgentFury) since the install dir is read-only.
        import os

        override = os.environ.get("AGENTFURY_DATA_DIR") or os.environ.get(
            "AGENTFORGE_DATA_DIR"
        )
        d = Path(override) if override else (BASE_DIR / "data")
        d.mkdir(parents=True, exist_ok=True)
        return d

    @property
    def db_path(self) -> Path:
        # v2 introduces multi-user auth (new schema with user_id columns).
        return self.data_dir / "agentforge_v2.sqlite3"

    @property
    def chroma_dir(self) -> Path:
        d = self.data_dir / "chroma"
        d.mkdir(parents=True, exist_ok=True)
        return d

    @property
    def groq_key_pool(self) -> list[str]:
        """All Groq keys, de-duplicated: the primary key plus any extras."""
        keys = [self.groq_api_key] + [
            k.strip() for k in self.groq_api_keys.split(",")
        ]
        seen, out = set(), []
        for k in keys:
            if k and k not in seen:
                seen.add(k)
                out.append(k)
        return out

    @property
    def workspace_path(self) -> Path:
        # Resolve workspace_dir relative to backend/ if it is relative.
        p = Path(self.workspace_dir)
        if not p.is_absolute():
            p = BASE_DIR / p
        p.mkdir(parents=True, exist_ok=True)
        return p.resolve()


settings = Settings()

# Export the Groq key to the process environment as well. Some library versions
# read GROQ_API_KEY directly from os.environ; this makes us robust either way.
import os  # noqa: E402

if settings.groq_api_key:
    os.environ.setdefault("GROQ_API_KEY", settings.groq_api_key)
