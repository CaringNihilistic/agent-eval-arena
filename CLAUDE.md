# Agent Eval Arena

An agent evaluation presented as a game. Three Claude models ran the same 30 tasks three times. A player sees their answers as unsigned letters in the seats of six fictional guests, decides which to trust without knowing who wrote them, and then sees the authors, our measured results, and Anthropic's published benchmarks. Preferences feed an Elo ranking shown next to the official-benchmark ranking and our scorer.

The project exists to show skill in agent evaluation and observability. Correct trace data, honest scoring, and reproducibility outrank visual polish.

- Design and phase plan: `docs/PLAN.md`
- Why things are the way they are: `docs/DECISIONS.md`
- What was learned about models and providers, with evidence: `docs/FINDINGS.md`. Add an entry whenever a real run shows provider-specific behaviour.

**Current state: Checkpoint D (two rooms, plain-words landing page) done and live. The site is "Poison Pen: A Wrenfield Hall Mystery", a game over 270 recorded runs (three of every model on every task), live at https://agent-eval-arena.vercel.app/ (Vercel Hobby, Neon Free). Two rooms are open, The Drawing Room (the main game) and A Weekend at Wrenfield; the other three are closed but their decisions are kept (`PLAYABLE_MODES`, PLAN Section 0.3). The Playwright suite passed against the live site on 2026-10-06. Its test decisions must be removed from the live database with `db:clean-e2e` after every live run; **this has not been done for the 2026-10-06 run (and probably not for 2026-10-03), because Neon's connection string is not on this machine.** No new features. `docs/PLAN.md` Sections 0, 0.1, 0.2, and 0.3 are the current design.** Update this line at the end of every checkpoint.

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

- **Frontend:** Next.js 16 (App Router), TypeScript strict, Tailwind CSS, shadcn/ui, TanStack Query, react-markdown with remark-gfm, Mermaid, the `postgres` driver. React Flow and Recharts are installed and not yet used. Tests: Vitest, React Testing Library, one Playwright end-to-end test.
- **Backend:** Python 3.11+, FastAPI, Pydantic v2, Claude Agent SDK. LangGraph and LiteLLM remain for the unused LiteLLM backend. Used only to record runs. Tests: pytest.
- **Database:** Postgres for votes and rate-limit counters (Docker locally on port 5433, Neon Free in public). Recorded runs are JSONL files in `data/recordings/`; there is no run database.
- **Hosting:** Vercel Hobby (web) and Neon Free (Postgres). The Python backend is never hosted. There is no live mode.
- **Replay:** one JSON response per match, played in the browser. Before the vote it plays at one fixed pace, because speed identifies the model.
- **Tooling:** uv (inside containers), pnpm (host), ruff, mypy, eslint, prettier, docker-compose.

## Environment

- The host is Windows 11. The shell is PowerShell; Git Bash is available.
- The Python backend and the sandbox run in Docker. `uv` is not installed on the host: run backend tools through `node scripts/py.mjs <api|sandbox> <cmd>`, which wraps `docker compose run --rm <service> uv run <cmd>`.
- Docker Desktop must be running. If Docker causes problems, report it and ask before moving anything to WSL.
- The SQLite file lives in a Docker named volume, never on a Windows bind mount.
- Ports: web on 3100 (3000 is used by another project on this machine), API on 8000. Both can be changed in `.env`.
- The sandbox has no network and a read-only filesystem. Docker's health check starts a process inside it every five seconds; `is_injected` in `executor.py` is what tells that apart from a process left by executed code. After changing its dependencies, rebuild the image (`docker compose build sandbox`); `uv` cannot sync inside it.
- Daily development runs the web app on the Windows host and only `api` and `sandbox` in Docker: `pnpm dev:local`. Host dev uses Turbopack and hot-reloads in about a second.
- The `web` container is a production-build check only (`pnpm web:prodcheck`): it installs, runs `next build`, and serves with `next start`. It sits behind the compose profile `web`, so a plain `docker compose up` does not start it. It keeps its own `node_modules` and `.next` in Docker volumes, and it uses port 3100, so stop host dev first.

## Commands

```
pnpm dev:local                         # Postgres in Docker, web on the host (3100)
pnpm dev:stop                          # stop and remove the containers
pnpm web:prodcheck                     # production build of the web app in a container
docker compose up                      # api (8000) and sandbox (internal only), no web
pnpm lint                              # eslint + prettier check + ruff + schema:check
pnpm typecheck                         # tsc + mypy (api and sandbox)
pnpm test:web                          # vitest
pnpm test:api                          # pytest for api and sandbox, in their containers
pnpm test:e2e                          # Playwright: builds the site, plays both open rooms in Edge, own database
E2E_BASE_URL=<url> pnpm --filter web e2e   # the same suite against a deployed site (no build, no local database)
pnpm --filter web db:migrate -- --from NAME     # apply the schema to the database in env var NAME (default DATABASE_URL)
pnpm --filter web db:clean-e2e -- --from NAME   # remove the decisions the e2e test made there
node scripts/make-guest-portraits.mjs  # redraw the built-in SVG portraits
pnpm format                            # prettier + ruff format
pnpm schema:gen                        # regenerate TS and Pydantic types from the JSON Schema
pnpm schema:check                      # fail if generated types are stale
node scripts/py.mjs api <cmd>          # any uv-run command in the api container
docker compose exec api uv run arena list
docker compose up -d --wait api sandbox                 # needed only to record or run agents
docker compose exec api uv run arena record             # record every missing run; resumable; uses the subscription
docker compose exec api uv run arena record --take 2    # a further run of each pair (takes 2 and 3 are recorded)
docker compose exec api uv run arena record --index-only   # rebuild runs-index and tasks
docker compose exec api uv run arena run --config claude-haiku-full --task dev-math-01   # uses the subscription
```

The Postgres store tests run only when `TEST_DATABASE_URL` is set (see `apps/web/src/server/store.pg.test.ts`).

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
- `apps/api/src/arena/recording.py`: the recorder and the index builder. The files it writes are the only run store.
- `apps/web/src/lib/blind-view.ts`: the only redaction code. `apps/web/src/test/leak-scan.ts` is the check every blind response must pass; `round-service.test.ts` runs it over every round of every mode built from the real recordings.
- `apps/web/src/lib/rounds.ts`: how rounds are dealt: pairing, traps, difficulty, seeds, seats. `assignGuests` takes a count and a seed and must never be given a run or a model.
- `apps/web/src/lib/scoring.ts`: points, ranks, distinctions, candles. `judge` sees the round's facts and the answer, never other players' votes.
- `apps/web/src/lib/leaderboard.ts`, `elo.ts`, `stats.ts`, `casebook.ts`: the only implementations of Elo, intervals, agreement, length, position and costume bias, the official ranking, the Casebook, and taste compatibility.
- `apps/web/src/server/`: `recordings.ts` reads `data/`, `store.ts` is the Postgres store (decisions, shares, challenges, counters), `round-service.ts` holds the rules for dealing, deciding, and revealing. Route handlers in `src/app/api/` only translate HTTP.
- `apps/web/src/components/game/`: the table (`round-table.tsx`), letters, the verdict panel, the reveal, the Casebook, the Official Record. `components/theme/`: ornaments and portraits.
- `apps/web/src/components/answer-view.tsx`, `mermaid-diagram.tsx`: the only places model output is rendered as markdown or as a diagram.
- `apps/web/src/lib/guests.ts`, `apps/web/public/guests/<id>/<expression>.svg`: the six guests. A PNG with the same name replaces the SVG with no code change.
- `apps/web/src/app/globals.css`: every colour, font, and ornament measure. `src/test/theme.test.ts` checks contrast and that no component holds a colour literal.
- `apps/web/e2e/`: the Playwright test.
- `data/official-benchmarks.json`: Anthropic's published scores. Copy from the official page, never from memory; keep the source URL and update `checked`.
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

### Fairness (the game's rules; these outrank everything else in the web app)

- Guests are costumes. Seats are dealt from a hash of the round (and the voter, in free play), never from the run or its model.
- Before a decision a letter is sent as its seat, its guest, and its final answer (taken from the blind view), nothing else. The server withholds: config, model, system prompt, run id, tokens, cost, word counts, the scorer's result, thinking blocks, latencies, timestamps, the trace with its steps and tool calls (Haiku takes more steps, so the count identifies it), the agent's working-folder name, the trap flag, and the guests' expressions (PLAN Sections 0.1 and 0.2). Redaction happens on the server, never in the browser.
- Nothing shown before a decision may depend on recorded time or on how many steps a run took.
- Any new field that reveals the result, the cost, the speed, or the identity of an author must be added to the blind-view redaction and to `WITHHELD_KEYS` in the leak scan, and a new mode must be added to the every-mode leak test.
- A check that cannot run is an error, never a failed answer: a parser timeout or an unreachable sandbox leaves the run unscored.
- Points come only from answers that can be right or wrong. A preference earns nothing, and nothing is awarded for agreeing with other players.
- Elo uses only preferences from The Drawing Room and The Library Gathering, never a trap round. The Library is closed; the rankings made there still count.
- A closed room deals no new round (`nextRound` answers 410), but its mode, its round ids, and its decisions stay. Do not remove a mode from `MODES` or from the every-mode leak test while the database holds decisions made in it.
- Every decision stores its mode, kind, the guest and position of each letter, confidence, the trap flag, answer lengths, and pass state.
- Model output is untrusted. Render it only through `AnswerView`: markdown with no raw-HTML plugin, Mermaid at the strict security level.
- No real author's name, detective, or book title anywhere in the product; a test scans for them.

### Theme

- Colours, fonts, and ornament measures are tokens in `globals.css`. Components use Tailwind names mapped to tokens and never a colour literal. No gradients (the pinstripe is hard-edged), no emoji.
- Text on a dark surface and text on parchment use different tokens; put content on paper inside `.parchment` or `.on-parchment` and the semantic names (`foreground`, `muted-foreground`, `border`) switch by themselves.
- Component classes are prefixed `deco-`: Mermaid uses `label` and `title` inside diagrams.

### Cost and safety

- **The project costs $0.** No paid API usage and no paid hosting, ever, unless the owner explicitly says otherwise.
- The runner refuses any model not marked free or subscription in the pricing table. The only bypass is an explicit override (`--allow-paid` or `ARENA_ALLOW_PAID_MODELS=1`); never set it on your own initiative.
- Model names, free-tier limits, and prices come from official provider pages, never from memory. Record the source URL and the date checked in the pricing table and in `docs/DECISIONS.md`.
- Record both `cost_usd` (actually charged) and `reference_cost_usd` (at paid list price). Never present the reference figure as money spent.
- Rate-limit waits are excluded from latency, timeouts, and replay pacing. A run interrupted by rate limiting is re-run, never recorded as an agent failure.
- Claude calls go only through the Claude Agent SDK on the owner's subscription login (`CLAUDE_CODE_OAUTH_TOKEN`). Never send a Claude request with an API key, and never set `ANTHROPIC_API_KEY` or any variable in `claude_auth.FORBIDDEN_VARIABLES`.
- The Claude backend is local only. It is never deployed, and nothing in `apps/web` may reference it.
- Claude runs use the owner's Pro allowance. Do not run them without being asked, keep them sequential, and stop cleanly at a usage limit.
- Never hardcode API keys. Real keys go in `.env` only. `.env.example` is committed to a public repo and must keep every secret empty; `pnpm lint` checks this.
- No test may call a real model. Use the scripted fake client.
- Recordings written to `data/recordings/` are scrubbed of API keys, auth headers, and `.env` values, and a test fails if a key-like pattern appears there.
- The 270 runs are recorded. Do not re-record or add runs without being asked: a new run replaces a file that rounds and decisions refer to.
- Task content is synthetic only.
- Agent tools have no live web access. `python_exec` runs only in the sandbox container. Never mount the Docker socket.
- Rate limit counters live in the database, not in memory.
- The repo is public. Scan history for secrets before pushing anything that touches credentials or recordings.

### Code

- TypeScript: strict, no `any`.
- Python: every function typed; mypy clean.
- Keep functions small.
- Letters must be distinguishable without colour alone (each has a letter and a guest), and all text meets WCAG AA contrast.

### Next.js 16

Next.js 16 has breaking changes relative to older versions. Before writing frontend code that touches routing, params, caching, or request handling, read the relevant guide in `apps/web/node_modules/next/dist/docs/`. Known differences: `params` and `searchParams` are promises, and middleware is now `proxy`.

### Git

- Commit at the end of each checkpoint, and at sensible points within one, with clear messages.
- Push to `origin` at the end of each checkpoint, after scanning history for secrets.
