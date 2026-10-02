# Build context is the repository root.

# The Mermaid parser is JavaScript. It is installed in its own stage, and only
# the Node binary and the installed packages are copied into the final image.
FROM node:22-bookworm-slim AS mermaid
WORKDIR /opt/mermaid
COPY apps/sandbox/mermaid/package.json apps/sandbox/mermaid/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY apps/sandbox/mermaid/check.mjs ./

FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir uv

WORKDIR /repo/apps/sandbox

ARG UV_SYNC_ARGS=""
COPY apps/sandbox/pyproject.toml apps/sandbox/uv.lock ./
RUN uv sync --frozen --no-install-project $UV_SYNC_ARGS

COPY --from=mermaid /usr/local/bin/node /usr/local/bin/node
COPY --from=mermaid /opt/mermaid /opt/mermaid

COPY apps/sandbox /repo/apps/sandbox
RUN uv sync --frozen $UV_SYNC_ARGS && rm -rf /root/.cache/uv

# At runtime the root filesystem is read-only and there is no network, so uv
# must not try to sync, and tool caches go to the tmpfs.
ENV UV_NO_SYNC=1 \
    UV_OFFLINE=1 \
    UV_CACHE_DIR=/tmp/uv \
    RUFF_CACHE_DIR=/tmp/ruff \
    MYPY_CACHE_DIR=/tmp/mypy

# The service runs unprivileged. Compose adds the read-only root filesystem,
# dropped capabilities, resource limits, and the internal-only network.
RUN useradd --system --uid 10001 --no-create-home sandbox
USER sandbox

EXPOSE 8001
CMD ["uvicorn", "sandbox.main:app", "--host", "0.0.0.0", "--port", "8001"]
