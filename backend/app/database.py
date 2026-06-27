"""
Database setup (SQLAlchemy + SQLite).

SQLite needs zero installation and lives in a single file — perfect for a free,
self-hostable platform. The same code works against Postgres later: only the
connection URL changes (see docs/ROADMAP.md, "scaling the database").
"""
from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    """Base class all ORM models inherit from."""


def _make_engine():
    """SQLite locally; Postgres in the cloud (when DATABASE_URL is set)."""
    url = settings.database_url
    if url:
        # Render gives 'postgres://…'; SQLAlchemy 2.0 wants 'postgresql+psycopg://'.
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        return create_engine(url, pool_pre_ping=True, echo=False)
    return create_engine(
        f"sqlite:///{settings.db_path}",
        connect_args={"check_same_thread": False},
        echo=False,
    )


engine = _make_engine()

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def init_db() -> None:
    """Create tables if they don't exist, then apply tiny additive migrations.
    Called once on startup."""
    # Import models so they are registered on Base.metadata before create_all.
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_columns()


def _ensure_columns() -> None:
    """Add columns that were introduced after a table was first created, on BOTH
    SQLite and Postgres. `create_all` only creates *missing tables* — it never
    adds a column to a table that already exists, so a database created at an
    earlier point can be missing newer columns (this is what broke reminders/notes
    on the cloud). This back-fills them safely."""
    from sqlalchemy import text

    is_pg = engine.dialect.name == "postgresql"
    bool_default = "FALSE" if is_pg else "0"

    wanted = {
        "users": {
            "tone": "VARCHAR(40) DEFAULT 'friendly'",
            "about": "TEXT DEFAULT ''",
            "is_admin": f"BOOLEAN DEFAULT {bool_default}",
        },
        "reminders": {
            "due_at": "VARCHAR(40) DEFAULT ''",
            "notified": f"BOOLEAN DEFAULT {bool_default}",
        },
    }
    with engine.begin() as conn:
        for table, cols in wanted.items():
            if is_pg:
                # Postgres supports ADD COLUMN IF NOT EXISTS.
                for col, ddl in cols.items():
                    conn.execute(
                        text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {ddl}")
                    )
            else:
                existing = {
                    row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))
                }
                for col, ddl in cols.items():
                    if col not in existing:
                        conn.execute(
                            text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
                        )


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a request-scoped DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
