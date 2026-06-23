# AGENTS.md — How to run the test suite correctly

Read this before running any tests. The backend suite has a config-discovery
gotcha that will produce mass failures if you run it the wrong way.

## TL;DR — verified commands

### Backend (requires PostgreSQL)
```bash
# 1. Start PostgreSQL (the test suite needs it)
docker compose -f tests/docker-compose.yml up -d postgres
# wait for healthy:
docker inspect --format '{{.State.Health.Status}}' tests-postgres-1   # -> healthy

# 2. Run the suite — MUST be from backend/ with NO path argument
cd backend && python -m pytest -v          # ✓ 363 passed

# 3. Stop PostgreSQL when done
docker compose -f tests/docker-compose.yml stop postgres
```

### Frontend (self-contained, no server needed)
```bash
cd frontend && npx vitest run              # ✓ 327 passed (23 files)
cd frontend && npm run typecheck           # app typecheck
cd frontend && npm run typecheck:test      # test typecheck
```

---

## The backend pytest.ini gotcha (IMPORTANT)

`backend/pytest.ini` sets the asyncio loop-scope config that the session-scoped
asyncpg engine depends on:

```ini
[pytest]
asyncio_mode = auto
asyncio_default_fixture_loop_scope = session
asyncio_default_test_loop_scope = session
testpaths = ../tests/backend
pythonpath = .
```

pytest only loads this file when `backend/` is the **rootdir**. That happens
when you run `pytest` *from* `backend/` with **no path argument** (then
`testpaths = ../tests/backend` collects the tests). It does **not** happen if
you pass an explicit path, because the rootdir then resolves to the repo root
and `backend/pytest.ini` (a sibling, not an ancestor) is never discovered.

| Command (run from `backend/`) | pytest.ini loaded? | Result |
|---|---|---|
| `python -m pytest -v` | yes (rootdir=backend) | ✅ 363 passed |
| `python -m pytest -c pytest.ini ../tests/backend -v` | yes (explicit -c) | ✅ 363 passed |
| `python -m pytest ../tests/backend -v` | **no** (rootdir=repo root) | ❌ ~15 failed + ~114 errors |

### What the wrong command looks like
Without the config you get asyncpg event-loop errors such as:

```
RuntimeError: Task ... got Future ... attached to a different loop
sqlalchemy.exc.InterfaceError: cannot perform operation: another operation is in progress
```

These are **not** caused by your code or the database — they're a
loop-scope mismatch from the missing `asyncio_default_test_loop_scope = session`
setting. If you see these, you ran the suite the wrong way; switch to
`cd backend && python -m pytest -v` and they disappear.

### Rule
- **Run backend tests from `backend/` with no path arg.** Rely on `testpaths`.
- If you must pass a path (e.g. to run a single file), add `-c pytest.ini`:
  ```bash
  cd backend && python -m pytest -c pytest.ini ../tests/backend/api/test_packets.py -v
  ```
- Never run `cd backend && python -m pytest ../tests/backend` without `-c`.

## PostgreSQL prerequisite

Backend integration tests (everything under `tests/backend/api/`, `models/`,
`services/`, and `test_migrations.py`) need PostgreSQL on
`postgresql+asyncpg://pcap:pcap@localhost:5432/pcap_test`.

```bash
# Start (only the postgres service is needed; web/nginx are not)
docker compose -f tests/docker-compose.yml up -d postgres

# Wait for healthy (usually a few seconds)
until [ "$(docker inspect --format '{{.State.Health.Status}}' tests-postgres-1)" = "healthy" ]; do sleep 1; done

# Stop when finished
docker compose -f tests/docker-compose.yml stop postgres
```

Backend **unit** tests (`tests/backend/unit/*`) do not use the DB fixtures and
run without PostgreSQL, but the shared `conftest.py` still creates a
session-scoped engine at collection time, so the simplest path is to just have
PostgreSQL up for any backend run.

## What the counts should be

| Suite | Expected | Command |
|---|---|---|
| Backend | 363 passed, 0 failed | `cd backend && python -m pytest` |
| Frontend tests | 327 passed, 23 files | `cd frontend && npx vitest run` |
| Frontend app typecheck | clean | `cd frontend && npm run typecheck` |
| Frontend test typecheck | clean | `cd frontend && npm run typecheck:test` |

If your numbers are lower or you see loop-scope errors, re-read the gotcha
section above before assuming a code regression.

## Running a single test / file

```bash
# Backend: single file (note the -c pytest.ini when giving a path)
cd backend && python -m pytest -c pytest.ini ../tests/backend/unit/test_packet_fields.py -v

# Backend: single test by node id
cd backend && python -m pytest -c pytest.ini "../tests/backend/api/test_packets.py::TestPacketDetail::test_detail_returns_full_record" -v

# Backend: by marker
cd backend && python -m pytest -m unit -v        # unit only (no DB needed in theory)
cd backend && python -m pytest -m integration -v # integration only (needs DB)

# Frontend: single file
cd frontend && npx vitest run src/__tests__/components/CaptureCommandPanel.test.tsx

# Frontend: watch mode
cd frontend && npx vitest
```

## Notes
- Backend tests use `httpx.AsyncClient` + `ASGITransport` (not Starlette
  TestClient) and a session-scoped async engine patched into `app.db.session`.
  Per-test isolation is via a `_delete_all` fixture that `DELETE FROM`s all
  tables in reverse dependency order.
- `parse_pcap` is mocked in conftest so uploads don't trigger real parsing.
- Frontend tests use vitest with jsdom + `@testing-library/react`; no backend
  or DB needed. Source imports use the `@/` alias → `frontend/src/`.
- The wiki (`wiki/`) is a separate git repo — doc changes there are committed
  and pushed independently from the main repo.
