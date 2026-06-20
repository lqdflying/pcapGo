from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

# Pool tuning notes:
# - pool_size=10, max_overflow=10: bounded to keep Postgres max_connections happy
#   across multiple uvicorn workers.
# - pool_pre_ping=True: drop and reconnect dead connections (kills the
#   ConnectionResetError you see after wait_timeout/intermediaries).
# - pool_recycle=1800: recycle connections every 30 minutes so asyncpg never
#   sits on a server-killed idle socket.
engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_size=10,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=1800,
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass
