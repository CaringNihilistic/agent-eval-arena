# Build context is the repository root.
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir uv

WORKDIR /repo/apps/api

# Dependencies first, so source edits do not invalidate this layer.
ARG UV_SYNC_ARGS=""
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-install-project $UV_SYNC_ARGS

COPY packages/schema /repo/packages/schema
COPY apps/api /repo/apps/api
RUN uv sync --frozen $UV_SYNC_ARGS

EXPOSE 8000
CMD ["uvicorn", "arena.main:app", "--host", "0.0.0.0", "--port", "8000"]
