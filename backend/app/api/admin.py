from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import select, func

from app.config import settings
from app.db.session import async_session
from app.models import User, AllowedUser
from app.core.security import require_admin
from app.schemas.user import AllowedUserCreate, AllowedUserRead, AllowedUserList
from app.schemas.capture import GeoIPStatus
from app.services import geoip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users", response_model=AllowedUserList)
async def list_allowed_users(admin: User = Depends(require_admin)):
    async with async_session() as session:
        result = await session.execute(
            select(AllowedUser).order_by(AllowedUser.created_at.asc())
        )
        allowed_users = result.scalars().all()

        logged_in_logins_q = await session.execute(
            select(func.lower(User.login))
        )
        logged_in_logins = {row[0] for row in logged_in_logins_q.all()}

    users = [
        AllowedUserRead(
            id=au.id,
            github_login=au.github_login,
            role=au.role,
            added_by=au.added_by,
            created_at=au.created_at,
            has_logged_in=au.github_login.lower() in logged_in_logins,
        )
        for au in allowed_users
    ]
    return AllowedUserList(users=users, total=len(users))


@router.post("/users", response_model=AllowedUserRead, status_code=201)
async def add_allowed_user(
    body: AllowedUserCreate,
    admin: User = Depends(require_admin),
):
    login = body.github_login.strip()
    if not login:
        raise HTTPException(status_code=400, detail="github_login is required")

    if body.role not in ("user", "super_admin"):
        raise HTTPException(status_code=400, detail="role must be 'user' or 'super_admin'")

    async with async_session() as session:
        existing = await session.execute(
            select(AllowedUser).where(
                func.lower(AllowedUser.github_login) == func.lower(login)
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="User already exists in allowlist")

        au = AllowedUser(
            github_login=login,
            role=body.role,
            added_by=admin.login,
        )
        session.add(au)
        await session.commit()
        await session.refresh(au)

    logged_in = False
    async with async_session() as session:
        result = await session.execute(
            select(User).where(func.lower(User.login) == func.lower(login))
        )
        logged_in = result.scalar_one_or_none() is not None

    return AllowedUserRead(
        id=au.id,
        github_login=au.github_login,
        role=au.role,
        added_by=au.added_by,
        created_at=au.created_at,
        has_logged_in=logged_in,
    )


@router.delete("/users/{github_login}", status_code=204)
async def remove_allowed_user(
    github_login: str,
    admin: User = Depends(require_admin),
):
    if (
        settings.admin_github_user
        and github_login.lower() == settings.admin_github_user.lower()
    ):
        raise HTTPException(status_code=403, detail="Cannot delete seed admin")

    async with async_session() as session:
        result = await session.execute(
            select(AllowedUser).where(
                func.lower(AllowedUser.github_login) == func.lower(github_login)
            )
        )
        au = result.scalar_one_or_none()
        if not au:
            raise HTTPException(status_code=404, detail="User not found in allowlist")

        await session.delete(au)
        await session.commit()


@router.patch("/users/{github_login}", response_model=AllowedUserRead)
async def update_allowed_user_role(
    github_login: str,
    body: AllowedUserCreate,
    admin: User = Depends(require_admin),
):
    if (
        settings.admin_github_user
        and github_login.lower() == settings.admin_github_user.lower()
    ):
        raise HTTPException(status_code=403, detail="Cannot modify seed admin")

    if body.role not in ("user", "super_admin"):
        raise HTTPException(status_code=400, detail="role must be 'user' or 'super_admin'")

    async with async_session() as session:
        result = await session.execute(
            select(AllowedUser).where(
                func.lower(AllowedUser.github_login) == func.lower(github_login)
            )
        )
        au = result.scalar_one_or_none()
        if not au:
            raise HTTPException(status_code=404, detail="User not found in allowlist")

        au.role = body.role

        # Sync role to the users table if the user has logged in
        user_result = await session.execute(
            select(User).where(func.lower(User.login) == func.lower(github_login))
        )
        db_user = user_result.scalar_one_or_none()
        logged_in = db_user is not None
        if db_user and db_user.role != body.role:
            db_user.role = body.role
        await session.commit()
        await session.refresh(au)

    return AllowedUserRead(
        id=au.id,
        github_login=au.github_login,
        role=au.role,
        added_by=au.added_by,
        created_at=au.created_at,
        has_logged_in=logged_in,
    )


# ── GeoIP management ─────────────────────────────────────────────────────────

@router.get("/geoip", response_model=GeoIPStatus)
async def get_geoip_status(admin: User = Depends(require_admin)):
    return GeoIPStatus(**geoip.get_status())


class GeoIPUpdateRequest(BaseModel):
    url: str


def _geoip_http_error(exc: geoip.GeoIPError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.public_detail)


@router.post("/geoip/update", response_model=GeoIPStatus)
async def update_geoip_database(
    body: GeoIPUpdateRequest,
    admin: User = Depends(require_admin),
):
    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    try:
        await asyncio.to_thread(geoip.download_database, url)
    except geoip.GeoIPError as exc:
        raise _geoip_http_error(exc) from exc
    return GeoIPStatus(**geoip.get_status())


@router.post("/geoip/upload", response_model=GeoIPStatus)
async def upload_geoip_database(
    file: UploadFile = File(...),
    admin: User = Depends(require_admin),
):
    if not file.filename or not file.filename.lower().endswith(".mmdb"):
        raise HTTPException(status_code=400, detail="File must be a .mmdb file")

    dest = settings.geoip_db_path
    dest.parent.mkdir(parents=True, exist_ok=True)
    max_bytes = geoip.max_database_bytes()
    written = 0
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=dest.parent, suffix=".mmdb.upload.tmp", delete=False
        ) as tmp:
            tmp_path = tmp.name
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > max_bytes:
                    raise geoip.GeoIPSizeExceededError(max_bytes)
                tmp.write(chunk)
        await asyncio.to_thread(geoip.install_database_file, Path(tmp_path), dest)
    except geoip.GeoIPError as exc:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)
        raise _geoip_http_error(exc) from exc
    except Exception:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)
        raise
    finally:
        await file.close()
    return GeoIPStatus(**geoip.get_status())
