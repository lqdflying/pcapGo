# pcapGo

A self-hosted web application for uploading and analyzing network packet captures (`.pcap` / `.pcapng`). Provides Wireshark-style 3-pane inspection (packet list, protocol tree, hex dump), statistical analysis, and AI-powered per-conversation diagnostics via any OpenAI-compatible LLM.

## Features

- **Upload & Parse** `.pcap`, `.pcapng`, `.cap` files (up to 100 MB)
- **Wireshark-style Inspector**: virtualized packet list, expandable protocol layer tree, hex/ASCII dump
- **Statistics**: protocol hierarchy, endpoints, conversations, IO graph
- **AI Analysis**: per-conversation diagnostic summaries and issue detection (retransmissions, connection resets, handshake failures, etc.)
- **GitHub OAuth** authentication (no self-hosted user management needed)
- **Protocol Detection**: TCP, UDP, ICMP, HTTP, TLS, DNS, Redis, MySQL, PostgreSQL (detected by port)
- **Dark theme** (Catppuccin-inspired)

## Quick Start (Docker Compose)

### Prerequisites

- Docker and Docker Compose
- A GitHub OAuth App ([create one here](https://github.com/settings/developers))
- (Optional) An OpenAI-compatible API key for AI analysis (DeepSeek, OpenRouter, Ollama, etc.)

### Setup

1. **Clone and enter the directory:**
   ```bash
   cd pcapGo
   ```

2. **Copy the sample templates** — `docker-compose.prod.yml` and `.env.sample` are templates; keep the repo free of production secrets.

   **Production (1Panel / direct host):** deploy from a separate directory on the host:
   ```bash
   mkdir ~/pcapgo-deploy
   cp docker-compose.prod.yml ~/pcapgo-deploy/docker-compose.yml
   cp .env.sample             ~/pcapgo-deploy/.env
   # then point build.context in ~/pcapgo-deploy/docker-compose.yml at this repo
   ```

   **Testing / Development:** run from the repo:
   ```bash
   cp tests/.env.example .env
   ```

3. **Edit your `.env`** — fill in at minimum (production values live in `~/pcapgo-deploy/.env`; use your domain + external PostgreSQL there):
   ```
   DATABASE_URL=postgresql+asyncpg://pcap:your_db_password@<pg-host>:5432/pcap
   JWT_SECRET=$(openssl rand -hex 32)
   GITHUB_CLIENT_ID=your_github_oauth_client_id
   GITHUB_CLIENT_SECRET=your_github_oauth_client_secret
   GITHUB_OAUTH_REDIRECT_URL=https://YOUR_DOMAIN/auth/github/callback
   PUBLIC_BASE_URL=https://YOUR_DOMAIN
   ```

4. **Set up GitHub OAuth App:**
   - Go to [GitHub Developer Settings](https://github.com/settings/developers) → OAuth Apps → New OAuth App
   - **Homepage URL**: `http://localhost` (or your domain)
   - **Authorization callback URL**: `http://localhost/auth/github/callback` (match the value in `.env`)

5. **Start the services:**

   **Production (1Panel / direct host) — single self-contained container:**
   ```bash
   cd ~/pcapgo-deploy        # the deployment dir from step 2
   # edit .env: set DATABASE_URL, JWT_SECRET, GitHub OAuth, PUBLIC_BASE_URL
   docker compose up -d --build
   ```
   The backend serves the React SPA directly; 1Panel (or a reverse proxy) only provides HTTPS/domain proxy.
   Point `DATABASE_URL` at your PostgreSQL instance.

   **Testing / Development — full 3-container stack:**
   ```bash
   docker compose -f tests/docker-compose.yml up -d
   ```
   Starts PostgreSQL, FastAPI backend, and nginx (serves SPA + proxies API).

6. **Open** `http://localhost` — click "Sign in with GitHub" to authenticate, then upload a `.pcap` file.

### Enable AI Analysis

Set these values in `.env`:
```
LLM_API_KEY=sk-your-key-here
LLM_BASE_URL=https://api.deepseek.com/v1   # or your endpoint
LLM_MODEL=deepseek-chat                     # or your model
```

Leave `LLM_API_KEY` empty to disable AI analysis — the rest of the app works without it.

---

## Deploying on 1Panel

[1Panel](https://1panel.cn/) is a modern Linux server management panel. pcapGo provides a **single self-contained container** for 1Panel: the `Dockerfile` at project root builds both the React frontend and FastAPI backend into one image. 1Panel only handles the HTTPS domain proxy. PostgreSQL comes from 1Panel's built-in database feature.

### Step 1: Prepare the Project

The repo holds **sample templates** (`docker-compose.prod.yml`, `.env.sample`) plus the `Dockerfile` — keep it free of production secrets. Clone it onto your server as the source:
```bash
git clone <your-repo-url> /opt/pcapgo-src
cd /opt/pcapgo-src
```

For **1Panel** you paste copies of these samples into the 1Panel Compose editor (Step 3), so no separate deploy directory is required. For a **direct-host deploy** instead, copy them into a deployment directory:
```bash
mkdir /opt/pcapgo-deploy
cp docker-compose.prod.yml /opt/pcapgo-deploy/docker-compose.yml
cp .env.sample             /opt/pcapgo-deploy/.env
# point build.context in /opt/pcapgo-deploy/docker-compose.yml at /opt/pcapgo-src
```

Edit `.env` with your production values — **point DATABASE_URL at 1Panel's PostgreSQL**:
```env
DATABASE_URL=postgresql+asyncpg://pcap:<password>@<1panel-pg-host>:5432/pcap
JWT_SECRET=<openssl rand -hex 32>
GITHUB_CLIENT_ID=<your-github-oauth-client-id>
GITHUB_CLIENT_SECRET=<your-github-oauth-client-secret>
GITHUB_OAUTH_REDIRECT_URL=https://<your-domain>/auth/github/callback
PUBLIC_BASE_URL=https://<your-domain>
LLM_API_KEY=<your-llm-key>   # optional
```

### Step 2: Build the Image

The image is built by Compose from the root `Dockerfile` — either inside 1Panel (Step 3, from the pasted compose) or directly from the deployment directory:
```bash
cd /opt/pcapgo-deploy && docker compose build      # direct-host deploy
# 1Panel: the build runs when you confirm in Step 3
```

This multi-stage build:
1. Compiles the React frontend (`img.aksg.net/nodejs/nodejs:latest`)
2. Packages it with the FastAPI backend (`img.aksg.net/python/wolfi-python312:latest`)
3. Produces a single image that serves the SPA on port 8000

### Step 3: Deploy via 1Panel Web UI

1. Log into 1Panel at `https://<your-server-ip>:<1panel-port>`
2. Go to **Containers** → **Compose** → **Create Compose**
3. Paste the contents of `docker-compose.prod.yml` and `.env` directly into the editor
4. Set the **Compose file path** (e.g., `/opt/pcapgo`)
5. Click **Confirm** to build and start the container

### Step 4: Configure Reverse Proxy

1Panel's built-in **Website** feature adds HTTPS:

1. Go to **Website** → **Create Website** → **Reverse Proxy**
2. Set **Domain** to your domain name
3. Set **Proxy URL** to `http://127.0.0.1:8000`
4. Enable **HTTPS** with Let's Encrypt
5. Click **Confirm**

### Updating

```bash
# Pull the latest source + samples
cd /opt/pcapgo-src && git pull

# 1Panel: re-paste the updated docker-compose.prod.yml into the 1Panel editor
# Direct-host deploy: rebuild from the deployment directory
cd /opt/pcapgo-deploy && docker compose up -d --build
```

---

## Development (Without Docker)

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Set up a PostgreSQL database and update DATABASE_URL in app/config.py
# or set environment variables matching tests/.env.example

alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and proxies `/api` and `/auth` to the backend at `localhost:8000`.

---

## Architecture

### Production (Standalone)
```
browser → 1Panel (HTTPS proxy) → web:8000 (FastAPI + React SPA)
                                       → PostgreSQL (1Panel's DB)
                                       → scapy parser (pcap → JSONL)
                                       → OpenAI-compatible LLM (optional)
```
A single container built from the root `Dockerfile`. The backend serves the React SPA via `StaticFiles` on port 8000, so no separate nginx container is needed.

### Testing / Development
```
browser → nginx (static + reverse proxy) → FastAPI (uvicorn) → PostgreSQL
                                                        → scapy parser
                                                        → OpenAI-compatible LLM
```
Three containers from `tests/docker-compose.yml`: PostgreSQL, backend, and nginx.

### Data Flow

1. User uploads a `.pcap` file → stored on disk under `uploads/<user_id>/<capture_id>.pcap`
2. Background task runs `scapy.PcapReader` (streaming, low memory) → writes `capture_id.jsonl` (one JSON record per packet) + `capture_id.index.json` (byte offset index for O(1) random access)
3. Conversations are extracted (canonical 5-tuple grouping) and persisted to PostgreSQL
4. Frontend queries packets via paginated API that reads the JSONL index, not re-parsing
5. AI analysis iterates conversations, sends structured prompts to the LLM, streams results via SSE

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11, FastAPI, SQLAlchemy 2 (async), Alembic |
| Database | PostgreSQL 16 |
| Parsing | scapy (PcapReader) |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query/Virtual |
| Auth | GitHub OAuth (via authlib) + JWT cookies |
| LLM | OpenAI SDK (configurable base_url) |
| Infra | Docker Compose, Nginx |

---

## Testing

### Backend Tests (~180 tests, pytest + asyncpg)
```bash
# Requires PostgreSQL on localhost:5432 with pcap_test database
cd backend && python -m pytest -v
```

Tests live in `tests/backend/` (API integration, model CRUD, unit tests, migrations).

### Frontend Tests (12 files, 95 tests, vitest + jsdom)
```bash
cd frontend && npx vitest run
```

Tests live in `frontend/src/__tests__/` (6 component tests, 3 page tests, App router, API client, Zustand stores). No backend required.

### Full Stack (Docker)
```bash
docker compose -f tests/docker-compose.yml up -d
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password |
| `DATABASE_URL` | Yes | asyncpg connection string |
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth App client secret |
| `GITHUB_OAUTH_REDIRECT_URL` | Yes | OAuth callback URL |
| `JWT_SECRET` | Yes | Secret for signing JWT tokens |
| `PUBLIC_BASE_URL` | Yes | Base URL of the deployment |
| `LLM_BASE_URL` | No | OpenAI-compatible API base URL |
| `LLM_API_KEY` | No | API key for the LLM (empty = AI disabled) |
| `LLM_MODEL` | No | Model name to use |
| `MAX_UPLOAD_MB` | No | Max upload size in MB (default 100) |

---

## Privacy & Data

- Uploaded PCAP files are stored on the server disk and are readable by the server administrator.
- Files are organized per-user under `uploads/<user_id>/`.
- Deleting a capture via the UI removes the file, parsed caches, and all associated database records.
- No files are automatically expired — you must delete them, or set up a cron job.

---

## License

MIT
