# Agent Eval Arena

Side-by-side agent evaluation: two agent configs run the same task, their traces stream into a split view, a scorecard compares them, and a blind vote feeds an Elo leaderboard next to an objective one.

The project exists to show skill in agent evaluation and observability. Correct trace data, honest scoring, and reproducibility outrank visual polish.

- Design and phase plan: `docs/PLAN.md`
- Why things are the way they are: `docs/DECISIONS.md`
- What was learned about models and providers, with evidence: `docs/FINDINGS.md`. Add an entry whenever a real run shows provider-specific behaviour.

**Current phase: 3 complete with the revised six-category task bank (Checkpoint A, four-run Claude pilot done). Next: Phase 4. With the owner: approval of the sandbox's Mermaid dependencies, the web markdown and Mermaid dependencies for Phase 5, and replacing the Gemini pair with gpt-oss-20b.** Update this line at the end of every phase.

## How we work

- Work in phases as listed in `docs/PLAN.md` Section 10. Do not start a phase without the owner's "go".
- For every phase: list the files to create or change, implement, write tests, run them, commit with a clear message, push to `origin` (public GitHub repo `CaringNihilistic/agent-eval-arena`), then report what was done, the exact commands to verify it, decisions made, and open questions. Then stop.
- Add a line to `docs/DECISIONS.md` for every significant decision.
- Every piece of logic has exactly one implementation. Elo, confidence intervals, the agreement stat, and blind-view redaction live only in TypeScript (`apps/web`); Python must not compute them.
- If the brief or the plan has a flaw, say so plainly and propose a fix. Do not silently work around it.
- Ask before adding any dependency that is not in the stack below or already approved in `docs/DECISIONS.md`.

## Layout

```
apps/web         Next.js 16 frontend
apps/api         FastAPI backend, agent runner, scorers, `arena` CLI
apps/sandbox     Isolated Python execution service (python_exec, python_check)
packages/schema  Trace event JSON Schema; generates TS types and Pydantic models
tasks/           Task bank (YAML), CSV fixtures, doc corpus, checker functions
data/recordings  Exported recorded runs (JSONL, scrubbed of secrets, committed)
docs/            PLAN.md, DECISIONS.md
```

## Stack

- **Frontend:** Next.js 16 (App Router), TypeScript strict, Tailwind CSS, shadcn/ui, React Flow, Recharts, TanStack Query. Tests: Vitest, React Testing Library, one Playwright end-to-end test.
- **Backend:** Python 3.11+, FastAPI, Pydantic v2, LangGraph, LiteLLM, SQLAlchemy 2.0, Alembic. Tests: pytest.
- **Database:** SQLite for the local run store (Python). Postgres for votes and rate-limit counters (Docker locally, Neon Free in public).
- **Hosting:** Vercel Hobby (web) and Neon Free (Postgres). The Python backend is never hosted; live mode is local-only.
- **Streaming:** Server-Sent Events for local live matches. Public replays are one JSON response, paced in the browser.
- **Tooling:** uv (inside containers), pnpm (host), ruff, mypy, eslint, prettier, docker-compose.

## Environment

- The host is Windows 11. The shell is PowerShell; Git Bash is available.
- The Python backend and the sandbox run in Docker. `uv` is not installed on the host: run backend tools through `node scripts/py.mjs <api|sandbox> <cmd>`, which wraps `docker compose run --rm <service> uv run <cmd>`.
- Docker Desktop must be running. If Docker causes problems, report it and ask before moving anything to WSL.
- The SQLite file lives in a Docker named volume, never on a Windows bind mount.
- Ports: web on 3100 (3000 is used by another project on this machine), API on 8000. Both can be changed in `.env`.
- The sandbox has no network and a read-only filesystem. After changing its dependencies, rebuild the image (`docker compose build sandbox`); `uv` cannot sync inside it.
- Daily development runs the web app on the Windows host and only `api` and `sandbox` in Docker: `pnpm dev:local`. Host dev uses Turbopack and hot-reloads in about a second.
- The `web` container is a production-build check only (`pnpm web:prodcheck`): it installs, runs `next build`, and serves with `next start`. It sits behind the compose profile `web`, so a plain `docker compose up` does not start it. It keeps its own `node_modules` and `.next` in Docker volumes, and it uses port 3100, so stop host dev first.

## Commands

```
pnpm dev:local                         # api + sandbox in Docker, web on the host (3100)
pnpm dev:stop                          # stop and remove the containers
pnpm web:prodcheck                     # production build of the web app in a container
docker compose up                      # api (8000) and sandbox (internal only), no web
pnpm lint                              # eslint + prettier check + ruff + schema:check
pnpm typecheck                         # tsc + mypy (api and sandbox)
pnpm test:web                          # vitest
pnpm test:api                          # pytest for api and sandbox, in their containers
pnpm format                            # prettier + ruff format
pnpm schema:gen                        # regenerate TS and Pydantic types from the JSON Schema
pnpm schema:check                      # fail if generated types are stale
node scripts/py.mjs api <cmd>          # any uv-run command in the api container
docker compose exec api uv run arena list
docker compose exec api uv run arena eval --config qwen-full --delay 45   # real runs over the 30-task bank
docker compose exec api uv run arena run --config qwen-full --task dev-math-01
docker compose exec api uv run arena run --config claude-haiku-full --task dev-math-01   # uses the subscription
```

Planned, not yet available: `pnpm test:e2e` (Phase 9), `arena export` (Phase 4), `arena record --pilot` (Phase 8).

## Where things are (backend)

- `apps/api/src/arena/run_context.py`: limits, tool execution, cost, and event emission for one run. Shared by every backend; put anything a second loop would also need here, not in a backend.
- `apps/api/src/arena/backends/`: agent loops. `litellm_loop.py` is the LangGraph loop; `agent_sdk.py` drives Claude Code through the Claude Agent SDK; `claude_auth.py` holds the checks that keep Claude runs on the subscription login; `base.py` is the interface.
- `apps/api/src/arena/scrub.py`: removes credentials from everything that is stored. `apps/api/tests/test_no_secrets.py` scans the repository.
- `apps/api/tests/fake_sdk.py`: the scripted Claude SDK client. It replays events in the order a real session produced them.
- `apps/api/src/arena/tools/`: the four arena tools and the `submit_answer` control tool.
- `apps/api/src/arena/data/pricing.yaml`: the pricing table and the free-only guard's source of truth.
- `apps/api/tests/fakes.py`: the scripted model client. Tests never call a real model.
- `apps/api/tests/recorded/`: responses real providers returned, used as regression fixtures. When a real run breaks, save the response there (`arena run --dump-raw`) and write the test from it.
- `apps/sandbox/src/sandbox/executor.py`: sandboxed execution. Its tests are escape attempts and must run inside the sandbox container.
- `apps/web/src/lib/blind-view.ts`: the only redaction code. `apps/web/src/test/leak-scan.ts` is the check every blind response must pass.
- `apps/api/src/arena/scoring.py`: the five scorers. `apps/api/tests/test_task_bank.py` re-derives every expected answer; a new task needs an entry there.
- `configs/`, `tasks/`: agent configs, prompts, tasks, fixtures, corpus, checkers. `tasks/tools/make_fixtures.py` regenerates the fixtures.

## Rules

### Trace events

- The schema in `packages/schema/trace-event.schema.json` is the only definition. Never hand-edit generated types; change the schema and run `pnpm schema:gen`.
- Every event is validated against the schema before it is stored.
- `seq` is strictly increasing per run with no gaps.
- Token counts come from provider-reported usage. Cost comes from the pricing table in the repo. Never estimate either.

### Scoring and honesty

- Prefer deterministic scorers. `llm_judge` only where unavoidable, with the judge's reasoning in `score_computed.explanation`.
- The judge model must not share a model family with any contestant config. The recorded task bank uses deterministic scorers only.
- Never send `scorer_config` or `examples` (expected answers, checker code) to the browser. `Task.public()` is the only view of a task that may leave the backend.
- Each task file carries known-correct and known-wrong answers under `examples`, and every prompt ends by saying exactly what form the answer takes.
- No placeholder logic or fake data in production paths. If something is stubbed, mark it `TODO(phase-N)` and mention it in the phase report.
- Results in the README are measured numbers from recorded runs, never illustrative ones.

### Blind voting

- Before the vote the UI shows only the traces, the final answers, step count, and elapsed time. Pass/fail, score, cost, tokens, and config names are revealed together after the vote.
- Until a voter has voted on a match, the server withholds config, model, system prompt, run id, token counts, cost, and the `score_computed` event from everything it serves for that match (PLAN Section 4.1). Redaction happens on the server, never in the browser.
- Any new field that reveals the result, the cost, or the identity of a side must be added to the blind-view redaction and its test.
- Every vote stores both sides' pass/fail state.

### Cost and safety

- **The project costs $0.** No paid API usage and no paid hosting, ever, unless the owner explicitly says otherwise.
- The runner refuses any model not marked `free_tier` in the pricing table. The only bypass is an explicit override (`--allow-paid` or `ARENA_ALLOW_PAID_MODELS=1`); never set it on your own initiative.
- Model names, free-tier limits, and prices come from official provider pages, never from memory. Record the source URL and the date checked in the pricing table and in `docs/DECISIONS.md`.
- Record both `cost_usd` (actually charged) and `reference_cost_usd` (at paid list price). Never present the reference figure as money spent.
- Rate-limit waits are excluded from latency, timeouts, and replay pacing. A run interrupted by rate limiting is re-run, never recorded as an agent failure.
- Gemini and Groq calls go through LiteLLM. Claude calls go only through the Claude Agent SDK on the owner's subscription login (`CLAUDE_CODE_OAUTH_TOKEN`). Never send a Claude request with an API key, and never set `ANTHROPIC_API_KEY` or any variable in `claude_auth.FORBIDDEN_VARIABLES`.
- The Claude backend is local only. It is never deployed, and nothing in `apps/web` may reference it.
- Claude runs use the owner's Pro allowance. Do not run them without being asked, keep them sequential, and stop cleanly at a usage limit.
- Never hardcode API keys. Real keys go in `.env` only. `.env.example` is committed to a public repo and must keep every secret empty; `pnpm lint` checks this.
- No test may call a real model. Use the scripted fake client.
- Recordings written to `data/recordings/` are scrubbed of API keys, auth headers, and `.env` values, and a test fails if a key-like pattern appears there.
- Before recording all 120 runs, run the 10-run pilot, report tokens per run, pass rates, and the projected duration, and wait for approval.
- Task content is synthetic only: free-tier inputs may be reviewed or used for training by the provider.
- Agent tools have no live web access. `python_exec` runs only in the sandbox container. Never mount the Docker socket.
- Rate limit counters live in the database, not in memory.
- The repo is public. Scan history for secrets before pushing anything that touches credentials or recordings.

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
