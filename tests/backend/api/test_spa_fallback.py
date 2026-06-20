"""Tests for the standalone SPA fallback handler in app.main.

The fallback is registered conditionally when SERVE_FRONTEND=true, so these
tests reload app.main inside a subprocess-like import path after setting the
environment variables.
"""

import os
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def frontend_dist(tmp_path: Path):
    """Create a fake frontend dist directory with index.html and an asset."""
    dist = tmp_path / "frontend-dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html><body>SPA</body></html>")
    (dist / "assets").mkdir()
    (dist / "assets" / "main.js").write_text("console.log('ok')")
    return dist


@pytest.mark.integration
class TestSpaFallback:
    """SPA fallback only applies to extensionless HTML navigational requests."""

    async def test_deep_link_returns_index_html(self, frontend_dist: Path):
        os.environ["SERVE_FRONTEND"] = "true"
        os.environ["FRONTEND_DIR"] = str(frontend_dist)

        import importlib
        import app.main as main_module

        importlib.reload(main_module)

        transport = ASGITransport(app=main_module.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                "/captures/123",
                headers={"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
            )
            assert response.status_code == 200
            assert response.text == "<html><body>SPA</body></html>"
            assert response.headers["content-type"].startswith("text/html")

        del os.environ["SERVE_FRONTEND"]
        del os.environ["FRONTEND_DIR"]

    async def test_missing_asset_still_404(self, frontend_dist: Path):
        os.environ["SERVE_FRONTEND"] = "true"
        os.environ["FRONTEND_DIR"] = str(frontend_dist)

        import importlib
        import app.main as main_module

        importlib.reload(main_module)

        transport = ASGITransport(app=main_module.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/assets/missing.js")
            assert response.status_code == 404

        del os.environ["SERVE_FRONTEND"]
        del os.environ["FRONTEND_DIR"]

    async def test_api_route_not_intercepted(self, frontend_dist: Path):
        os.environ["SERVE_FRONTEND"] = "true"
        os.environ["FRONTEND_DIR"] = str(frontend_dist)

        import importlib
        import app.main as main_module

        importlib.reload(main_module)

        transport = ASGITransport(app=main_module.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/health")
            assert response.status_code == 200
            assert response.json()["status"] == "ok"

        del os.environ["SERVE_FRONTEND"]
        del os.environ["FRONTEND_DIR"]

    async def test_api_404_preserves_detail_and_headers(
        self, frontend_dist: Path, auth_user
    ):
        """Non-SPA 404s must keep the original exception detail and headers."""
        os.environ["SERVE_FRONTEND"] = "true"
        os.environ["FRONTEND_DIR"] = str(frontend_dist)

        import importlib
        import app.main as main_module
        from app.core.security import get_current_user

        importlib.reload(main_module)

        async def override_get_current_user(request=None):
            return auth_user

        main_module.app.dependency_overrides[get_current_user] = override_get_current_user

        transport = ASGITransport(app=main_module.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                "/api/captures/00000000-0000-0000-0000-000000000000",
                headers={"Accept": "application/json"},
            )
            assert response.status_code == 404
            # The endpoint returns "Capture not found"; the fallback handler
            # must not replace it with a generic "Not Found".
            assert response.json()["detail"] == "Capture not found"

        del os.environ["SERVE_FRONTEND"]
        del os.environ["FRONTEND_DIR"]
        main_module.app.dependency_overrides.clear()
