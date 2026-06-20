# Multi-stage: build React frontend, then bundle with FastAPI backend.
#
# Base images come from the internal 0-CVE registry (Wolfi-based):
#   - img.aksg.net/nodejs/nodejs:latest        (Node 24 + npm)
#   - img.aksg.net/python/wolfi-python312:latest  (Python 3.12 + pip)
# Both are Wolfi OS images; no gcc/build-base is required because the Python
# dependencies ship manylinux wheels.
FROM img.aksg.net/nodejs/nodejs:latest AS frontend-build

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ .
RUN npm run build

FROM img.aksg.net/python/wolfi-python312:latest

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY --from=frontend-build /app/dist /app/frontend-dist

RUN chmod +x /app/entrypoint.sh && mkdir -p /app/uploads

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
