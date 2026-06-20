#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
cd /app && alembic upgrade head

echo "[entrypoint] Starting application: $@"
exec "$@"
