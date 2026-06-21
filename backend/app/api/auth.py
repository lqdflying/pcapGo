from __future__ import annotations

from fastapi import APIRouter, Request, Depends
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from authlib.integrations.starlette_client import OAuth
from authlib.integrations.base_client.errors import OAuthError
from httpx import AsyncClient, HTTPStatusError

from app.config import settings
from app.db.session import async_session
from app.models import User, AllowedUser
from app.core.security import create_access_token, set_jwt_cookie, clear_jwt_cookie, get_current_user
from app.schemas import UserRead
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

oauth = OAuth()
oauth.register(
    name="github",
    client_id=settings.github_client_id,
    client_secret=settings.github_client_secret,
    authorize_url="https://github.com/login/oauth/authorize",
    access_token_url="https://github.com/login/oauth/access_token",
    api_base_url="https://api.github.com/",
    client_kwargs={"scope": "user:email"},
)


async def _upsert_user(github_id: int, login: str, email, name, avatar_url, role: str = "user") -> User:
    """Insert the user or update existing fields. Race-safe against concurrent
    first logins via ON CONFLICT (github_id) DO UPDATE."""
    stmt = (
        pg_insert(User)
        .values(
            github_id=github_id,
            login=login,
            email=email,
            name=name,
            avatar_url=avatar_url,
            role=role,
        )
        .on_conflict_do_update(
            index_elements=[User.github_id],
            set_={
                "login": login,
                "email": email,
                "name": name,
                "avatar_url": avatar_url,
                "role": role,
            },
        )
        .returning(User)
    )
    async with async_session() as session:
        result = await session.execute(stmt)
        row = result.scalar_one()
        await session.commit()
        return row


@router.get("/github/login")
async def github_login(request: Request):
    redirect_uri = settings.github_oauth_redirect_url
    # Preserve the requested deep link across the GitHub round trip via the
    # session. The frontend passes ?next=<relative path> for unauthenticated
    # users hitting a protected route.
    next_url = _validate_next(request.query_params.get("next"))
    if next_url:
        request.session["oauth_next"] = next_url
    else:
        request.session.pop("oauth_next", None)
    return await oauth.github.authorize_redirect(request, redirect_uri)


def _validate_next(raw: str | None) -> str | None:
    """Validate a redirect target: must be a relative path starting with a
    single ``/``, not ``//`` (protocol-relative), and have no scheme."""
    if not raw or not isinstance(raw, str):
        return None
    if not raw.startswith("/"):
        return None
    if raw.startswith("//"):
        return None
    # Reject anything that looks like a scheme (e.g. "javascript:").
    if ":" in raw.split("/")[0] and not raw.startswith("/"):
        return None
    return raw


@router.get("/github/callback")
async def github_callback(request: Request):
    try:
        token = await oauth.github.authorize_access_token(request)
    except (OAuthError, KeyError) as e:
        # User denied consent, state mismatch, or callback misuse.
        logger.warning("OAuth callback failed: %s", e)
        return RedirectResponse(url="/?auth_error=denied")

    access_token = token.get("access_token") if isinstance(token, dict) else None
    if not access_token:
        logger.warning("OAuth callback returned no access_token")
        return RedirectResponse(url="/?auth_error=denied")

    try:
        async with AsyncClient() as client:
            resp = await client.get(
                "https://api.github.com/user",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                },
            )
            resp.raise_for_status()
            gh_user = resp.json()
    except HTTPStatusError as e:
        logger.warning("GitHub /user call failed: %s", e)
        return RedirectResponse(url="/?auth_error=github")
    except KeyError:
        logger.warning("GitHub response missing required fields")
        return RedirectResponse(url="/?auth_error=github")

    github_id = gh_user.get("id")
    login = gh_user.get("login")
    if github_id is None or login is None:
        logger.warning("GitHub response missing id/login: %r", gh_user)
        return RedirectResponse(url="/?auth_error=github")

    email = gh_user.get("email")
    name = gh_user.get("name")
    avatar_url = gh_user.get("avatar_url")

    async with async_session() as session:
        result = await session.execute(
            select(AllowedUser).where(
                func.lower(AllowedUser.github_login) == func.lower(login)
            )
        )
        allowed = result.scalar_one_or_none()

    if not allowed:
        logger.warning("Login rejected: %s not in allowed_users", login)
        return RedirectResponse(url="/login?auth_error=not_allowed")

    try:
        user = await _upsert_user(github_id, login, email, name, avatar_url, role=allowed.role)
    except IntegrityError:
        # Extremely rare: lost the ON CONFLICT race against a different unique
        # constraint. Fall back to a plain SELECT.
        async with async_session() as session:
            result = await session.execute(select(User).where(User.github_id == github_id))
            user = result.scalar_one()

    jwt = create_access_token(user.id, user.login)
    next_url = request.session.pop("oauth_next", None) or "/"
    response = RedirectResponse(url=next_url)
    set_jwt_cookie(response, jwt)
    return response


@router.get("/me", response_model=UserRead)
async def get_me(user: User = Depends(get_current_user)):
    return user


@router.post("/logout")
async def logout():
    response = JSONResponse(content={"message": "logged out"})
    clear_jwt_cookie(response)
    return response
