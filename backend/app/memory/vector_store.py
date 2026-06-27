"""
Long-term semantic memory (ChromaDB).

There are three layers of memory in this platform (see docs/ARCHITECTURE.md):
  1. Short-term  — the messages inside one conversation (LangGraph checkpointer).
  2. Structured  — agents/conversations/messages rows in SQLite.
  3. Semantic    — THIS file: embeddings of facts the agent should remember
                   long-term, searchable by meaning rather than keywords.

Chroma ships with a built-in embedding model (all-MiniLM, runs locally via
onnxruntime), so semantic memory costs nothing and needs no API key.

Each agent gets its own Chroma "collection" so memories never leak between
agents.
"""
from __future__ import annotations

import chromadb

from app.config import settings

_client = chromadb.PersistentClient(path=str(settings.chroma_dir))


def _collection(agent_id: str):
    # get_or_create is idempotent; the default embedding function is applied.
    return _client.get_or_create_collection(name=f"agent_{agent_id}")


def remember(agent_id: str, text: str, metadata: dict | None = None) -> str:
    """Store a fact for an agent. Returns the memory id."""
    import uuid

    mem_id = uuid.uuid4().hex
    # ChromaDB rejects empty metadata dicts, so always include at least one key.
    meta = {"source": "agent", **(metadata or {})}
    _collection(agent_id).add(
        ids=[mem_id],
        documents=[text],
        metadatas=[meta],
    )
    return mem_id


def recall(agent_id: str, query: str, k: int = 4) -> list[str]:
    """Return up to k facts most semantically similar to the query."""
    col = _collection(agent_id)
    if col.count() == 0:
        return []
    res = col.query(query_texts=[query], n_results=min(k, col.count()))
    docs = res.get("documents") or [[]]
    return docs[0]


def forget_all(agent_id: str) -> None:
    """Delete an agent's entire semantic memory (used when an agent is deleted)."""
    try:
        _client.delete_collection(name=f"agent_{agent_id}")
    except Exception:
        pass


# ----- User-level memory (shared across ALL of one user's agents) -----
# This is what personalises the assistant: a fact learned in one chat (e.g.
# "I'm preparing for campus placements") can be recalled by every agent.
def _user_collection(user_id: str):
    return _client.get_or_create_collection(name=f"user_{user_id}")


def remember_user(user_id: str, text: str) -> str:
    import uuid

    mem_id = uuid.uuid4().hex
    _user_collection(user_id).add(
        ids=[mem_id], documents=[text], metadatas=[{"source": "user"}]
    )
    return mem_id


def recall_user(user_id: str, query: str, k: int = 4) -> list[str]:
    col = _user_collection(user_id)
    if col.count() == 0:
        return []
    res = col.query(query_texts=[query], n_results=min(k, col.count()))
    docs = res.get("documents") or [[]]
    return docs[0]
