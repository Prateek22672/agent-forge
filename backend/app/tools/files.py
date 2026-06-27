"""
File tools — sandboxed to WORKSPACE_DIR.

SECURITY NOTE (important and reusable):
    Never let an LLM-driven tool touch arbitrary paths. Every path here is
    resolved and then checked to be *inside* the workspace directory, which
    blocks `../../etc/passwd`-style escapes. This is the same pattern you'd use
    for any "agent can edit files" feature, including the desktop phase later.
"""
from __future__ import annotations

from pathlib import Path

from langchain_core.tools import tool

from app.config import settings


def _safe_path(relative: str) -> Path:
    root = settings.workspace_path
    candidate = (root / relative).resolve()
    if root not in candidate.parents and candidate != root:
        raise ValueError("Path escapes the workspace sandbox.")
    return candidate


@tool
def list_files(subdir: str = "") -> str:
    """List files and folders in the agent's workspace (optionally a subfolder)."""
    try:
        target = _safe_path(subdir) if subdir else settings.workspace_path
    except ValueError as exc:
        return str(exc)
    if not target.exists():
        return "(empty or does not exist)"
    entries = sorted(p.name + ("/" if p.is_dir() else "") for p in target.iterdir())
    return "\n".join(entries) if entries else "(empty)"


@tool
def read_file(path: str) -> str:
    """Read a UTF-8 text file from the workspace. `path` is relative to the workspace."""
    try:
        p = _safe_path(path)
    except ValueError as exc:
        return str(exc)
    if not p.exists() or not p.is_file():
        return f"No such file: {path}"
    return p.read_text(encoding="utf-8", errors="replace")[:8000]


@tool
def write_file(path: str, content: str) -> str:
    """Create or overwrite a text file in the workspace. Returns a confirmation."""
    try:
        p = _safe_path(path)
    except ValueError as exc:
        return str(exc)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return f"Wrote {len(content)} characters to {path}"
