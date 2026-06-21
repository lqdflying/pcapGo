"""Integration tests for the /api/health endpoint."""

import pytest


@pytest.mark.integration
class TestHealthEndpoint:
    """Tests for GET /api/health."""

    async def test_health_returns_ok(self, test_client):
        response = await test_client.get("/api/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        # The endpoint reports a database liveness field (wiki/Deployment.md
        # documents this contract). Against the test DB the check must pass.
        assert body["database"] == "healthy"
        assert "version" in body
        assert "buildDate" in body

    async def test_health_no_auth_required(self, test_client):
        response = await test_client.get("/api/health")
        assert response.status_code == 200
