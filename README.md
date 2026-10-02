# Agent Eval Arena

Three Claude models were given the same 30 tasks with the same prompt and tools. You see two of them side by side on one task without knowing which is which, vote, and then see the models, this project's measured results, and Anthropic's published benchmarks.

**Work in progress.** All 90 runs are recorded and the replay site works locally. It is not deployed yet, and the measured results are not written up here yet.

- Design: [docs/PLAN.md](docs/PLAN.md) (Section 0 is the current design)
- Decisions and why: [docs/DECISIONS.md](docs/DECISIONS.md)
- What the runs showed: [docs/FINDINGS.md](docs/FINDINGS.md)

## Run it locally

Needs Node 24, pnpm, and Docker.

```
pnpm install
cp .env.example .env
pnpm dev:local        # starts Postgres in Docker and the site on http://localhost:3100
```

The recorded runs are in `data/recordings/`, so no model is called and no key is needed.
