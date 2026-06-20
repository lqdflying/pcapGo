"""API integration test conftest — no additional fixtures needed.

The root conftest already patches app.db.session before importing app.main,
so route modules capture the test-bound async_session at import time.
"""
