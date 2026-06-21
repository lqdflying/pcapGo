from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func

from app.config import settings
from app.db.session import async_session
from app.models import User, AllowedUser
from app.core.security import require_admin
from app.schemas.user import AllowedUserCreate, AllowedUserRead, AllowedUserList

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
        await session.commit()
        await session.refresh(au)

        # Sync role to the users table if the user has logged in
        user_result = await session.execute(
            select(User).where(func.lower(User.login) == func.lower(github_login))
        )
        db_user = user_result.scalar_one_or_none()
        logged_in = db_user is not None
        if db_user and db_user.role != body.role:
            db_user.role = body.role
            await session.commit()

    return AllowedUserRead(
        id=au.id,
        github_login=au.github_login,
        role=au.role,
        added_by=au.added_by,
        created_at=au.created_at,
        has_logged_in=logged_in,
    )
