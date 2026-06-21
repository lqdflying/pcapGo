from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta

from jose import JWTError, jwt
from fastapi import Depends, Request, HTTPException, status

from app.config import settings


def create_access_token(user_id: uuid.UUID, login: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "login": login,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


def get_jwt_from_cookie(request: Request) -> str | None:
    return request.cookies.get("pcap_session")


def set_jwt_cookie(response, token: str):
    response.set_cookie(
        key="pcap_session",
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.jwt_expire_minutes * 60,
        path="/",
    )


def clear_jwt_cookie(response):
    response.delete_cookie(key="pcap_session", path="/")


async def get_current_user(request: Request):
    from app.db.session import async_session
    from app.models import AllowedUser, User
    from sqlalchemy import func, select

    token = get_jwt_from_cookie(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        payload = decode_access_token(token)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    try:
        parsed_user_id = uuid.UUID(user_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    async with async_session() as session:
        user = await session.get(User, parsed_user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

        result = await session.execute(
            select(AllowedUser).where(
                func.lower(AllowedUser.github_login) == func.lower(user.login)
            )
        )
        allowed = result.scalar_one_or_none()
        if not allowed:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not allowed")

        if user.role != allowed.role:
            user.role = allowed.role
            await session.commit()
            await session.refresh(user)
        return user


async def require_admin(user=Depends(get_current_user)):
    if user.role != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


async def get_capture_for_user(session, capture_id: uuid.UUID, user):
    from app.models import Capture
    from sqlalchemy import select

    query = select(Capture).where(Capture.id == capture_id)
    if user.role != "super_admin":
        query = query.where(Capture.user_id == user.id)
    result = await session.execute(query)
    capture = result.scalar_one_or_none()
    if not capture:
        raise HTTPException(status_code=404, detail="Capture not found")
    return capture
