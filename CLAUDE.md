# Agent Eval Arena

Side-by-side agent evaluation: two agent configs run the same task, their traces stream into a split view, a scorecard compares them, and a blind vote feeds an Elo leaderboard next to an objective one.

The project exists to show skill in agent evaluation and observability. Correct trace data, honest scoring, and reproducibility outrank visual polish.

- Design and phase plan: `docs/PLAN.md`
- Why things are the way they are: `docs/DECISIONS.md`

**Current phase: 0 (planning), awaiting approval of `docs/PLAN.md`.** Update this line at the end of every phase.

## How we work

- Work in phases as listed in `docs/PLAN.md` Section 9. Do not start a phase without the owner's "go".
- For every phase: list the files to create or change, implement, write tests, run them, commit with a clear message, then report what was done, the exact commands to verify it, decisions made, and open questions. Then stop.
- Add a line to `docs/DECISIONS.md` for every significant decision.
- If the brief or the plan has a flaw, say so plainly and propose a fix. Do not silently work around it.
- Ask before adding any dependency that is not in the stack below or already approved in `docs/DECISIONS.md`.

## Layout

```
apps/web         Next.js 16 frontend
apps/api         FastAPI backend, agent runner, scorers, `arena` CLI
apps/sandbox     Isolated Python execution service (pending approval, PLAN open question 2)
packages/schema  Trace event JSON Schema; generates TS types and Pydantic models
tasks/           Task bank (YAML), CSV fixtures, doc corpus, checker functions
data/recordings  Exported recorded runs (pending approval, PLAN open question 5)
docs/            PLAN.md, ARCHITECTURE.md, DECISIONS.md
```

## Stack

- **Frontend:** Next.js 16 (App Router), TypeScript strict, Tailwind CSS, shadcn/ui, React Flow, Recharts, TanStack Query. Tests: Vitest, React Testing Library, one Playwright end-to-end test.
- **Backend:** Python 3.11+, FastAPI, Pydantic v2, LangGraph, LiteLLM, SQLAlchemy 2.0, Alembic. Tests: pytest.
- **Database:** SQLite in development, Postgres in production, same models.
- **Streaming:** Server-Sent Events, one stream per match, events tagged by side.
- **Tooling:** uv (inside containers), pnpm (host), ruff, mypy, eslint, prettier, docker-compose.

## Environment

- The host is Windows 11. The shell is PowerShell; Git Bash is available.
- The Python backend and the sandbox run in Docker. `uv` is not installed on the host: run backend commands as `docker compose exec api uv run <cmd>`.
- Docker Desktop must be running. If Docker causes problems, report it and ask before moving anything to WSL.
- The SQLite file lives in a Docker named volume, never on a Windows bind mount.

## Commands

These are the planned commands; they exist from Phase 1 onward. Keep this section accurate as scripts are added.

```
docker compose up                      # web, api, sandbox
pnpm lint                              # eslint + prettier check + ruff + schema:check
pnpm typecheck                         # tsc + mypy
pnpm test:web                          # vitest
pnpm test:api                          # docker compose exec api uv run pytest
pnpm test:e2e                          # playwright
pnpm schema:gen                        # regenerate TS and Pydantic types from the JSON Schema
pnpm schema:check                      # fail if generated types are stale
docker compose exec api uv run arena run --config X --task Y
docker compose exec api uv run arena eval --config X
docker compose exec api uv run arena record --pilot
```

## Rules

### Trace events

- The schema in `packages/schema/trace-event.schema.json` is the only definition. Never hand-edit generated types; change the schema and run `pnpm schema:gen`.
- Every event is validated against the schema before it is stored.
- `seq` is strictly increasing per run with no gaps.
- Token counts come from provider-reported usage. Cost comes from the pricing table in the repo. Never estimate either.

### Scoring and honesty

- Prefer deterministic scorers. `llm_judge` only where unavoidable, with the judge's reasoning in `score_computed.explanation`.
- The judge model must not share a model family with any contestant config.
- Never send `scorer_config` (expected answers, checker code) to the browser.
- No placeholder logic or fake data in production paths. If something is stubbed, mark it `TODO(phase-N)` and mention it in the phase report.
- Results in the README are measured numbers from recorded runs, never illustrative ones.

### Blind voting

- Until a voter has voted on a match, the server redacts config, model, system prompt, and run id from everything it serves for that match. Redaction happens on the server, never in the browser.
- Every vote stores both sides' pass/fail state.

### Cost and safety

- Model calls go through LiteLLM only. No provider SDKs.
- Never hardcode API keys. Use `.env`; keep `.env.example` committed and current.
- Visitor-supplied keys are held in memory for the duration of a run and are never written to the database or logs.
- No test may call a real model. Use the scripted fake client.
- Recording has a $20 total cap. Run the 10-run pilot, report cost per run and the projected total, and wait for approval before recording the rest.
- Agent tools have no live web access. `python_exec` runs only in the sandbox container. Never mount the Docker socket.
- Rate limit counters live in the database, not in memory.

### Code

- TypeScript: strict, no `any`.
- Python: every function typed; mypy clean.
- Keep functions small.
- Design tokens (colors, fonts, radii, spacing) live in one stylesheet as CSS variables. Components never hardcode them. The theme is not chosen yet; use neutral shadcn defaults.
- Left and right panes must be distinguishable without color alone, and meet WCAG AA contrast.

### Next.js 16

Next.js 16 has breaking changes relative to older versions. Before writing frontend code that touches routing, params, caching, or request handling, read the relevant guide in `apps/web/node_modules/next/dist/docs/`. Known differences: `params` and `searchParams` are promises, and middleware is now `proxy`.

### Git

- Commit at the end of each phase, and at sensible points within one, with clear messages.
- Local commits only. Do not add a remote or push unless asked.
