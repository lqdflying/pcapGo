from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import update
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.api import auth, uploads, packets, statistics, analysis, chat, capture_command
from app.db.session import engine
from app.models import Capture, CaptureStatus

logger = logging.getLogger(__name__)


async def _reset_stuck_captures() -> None:
    """BackgroundTasks do not survive a worker restart, so any capture still
    in `parsing` at startup is permanently stuck. Flip it to `failed` so the
    user can see the error and re-upload."""
    from app.db.session import async_session

    async with async_session() as session:
        result = await session.execute(
            update(Capture)
            .where(Capture.status == CaptureStatus.parsing)
            .values(status=CaptureStatus.failed)
        )
        count = result.rowcount or 0
        if count:
            logger.warning(
                "startup recovery: marked %d stuck 'parsing' capture(s) as 'failed'", count
            )
        await session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    await _reset_stuck_captures()
    try:
        yield
    finally:
        # Close the DB pool cleanly so connections aren't left for Postgres
        # to reap on shutdown.
        await engine.dispose()


app = FastAPI(
    title="pcapGo",
    description="pcapGo — Wireshark-like web-based packet capture analyzer",
    version="0.1.0",
    lifespan=lifespan,
)

# Middleware
_allowed_origins = [settings.public_base_url]
if settings.dev_mode:
    _allowed_origins += ["http://localhost:5173"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SessionMiddleware, secret_key=settings.effective_session_secret)

# Routers
app.include_router(auth.router)
app.include_router(uploads.router)
app.include_router(packets.router)
app.include_router(statistics.router)
app.include_router(analysis.router)
app.include_router(chat.router)
app.include_router(capture_command.router)


@app.get("/api/health")
async def health():
    # Cheap liveness probe against the configured engine. We always return
    # HTTP 200 so monitoring/alerting keys off the `database` field rather
    # than flapping on transient DB issues, but still report whether the
    # pool currently reaches Postgres.
    db_status = "healthy"
    try:
        from sqlalchemy import text as _sa_text

        async with engine.connect() as conn:
            await conn.execute(_sa_text("SELECT 1"))
    except Exception:
        db_status = "unhealthy"
    return {"status": "ok", "database": db_status}


# ── SPA (standalone mode) ──────────────────────────────────────────
# When SERVE_FRONTEND=true and the built frontend dist/ exists,
# mount it at /. Registered API routes (/api/*, /auth/*) take priority.
#
# SECURITY: never mount a StaticFiles directory that contains user-uploaded
# pcap files (uploads/). Uploads are stored out-of-band on disk and served
# only through authenticated API routes. See nginx/nginx.conf — there must
# not be any /uploads/ proxy rule either.
_SERVE = os.environ.get("SERVE_FRONTEND", "").lower() == "true"
_FRONTEND_DIR = os.environ.get("FRONTEND_DIR", "/app/frontend-dist")

if _SERVE and os.path.isdir(_FRONTEND_DIR):
    from starlette.exceptions import HTTPException as StarletteHTTPException

    @app.exception_handler(StarletteHTTPException)
    async def _spa_fallback(request, exc: StarletteHTTPException):
        """Serve index.html for unknown client-side routes (deep links) so
        the SPA router can handle them. Only applies to GET/HEAD requests
        that accept HTML and have an extensionless path outside /api and
        /auth — real asset misses (JS/CSS) still return 404."""
        is_html_nav = (
            exc.status_code == 404
            and request.method in ("GET", "HEAD")
            and "text/html" in request.headers.get("accept", "")
            and not request.url.path.startswith(("/api/", "/auth/"))
            and not os.path.splitext(request.url.path)[1]
        )
        if is_html_nav:
            index_path = os.path.join(_FRONTEND_DIR, "index.html")
            if os.path.isfile(index_path):
                from starlette.responses import FileResponse
                return FileResponse(index_path, media_type="text/html")
        # Fall back to the default handler for non-navigational 404s
        # (and all other status codes), preserving the original detail and
        # any headers set by the exception.
        from starlette.responses import JSONResponse
        return JSONResponse(
            {"detail": exc.detail},
            status_code=exc.status_code,
            headers=dict(exc.headers or {}),
        )

    app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")
