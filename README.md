# Poison Pen: A Wrenfield Hall Mystery

An evaluation of three AI models, played as a 1930s country-house mystery.

Every evening an unsigned letter appears at dinner at Wrenfield Hall. Six guests sit at the table, but only three authors wrote the letters: Claude Haiku 4.5, Sonnet 5.5, and Opus 5.5. Each letter is a recorded answer to one of 30 tasks. You decide which letters to trust without knowing who wrote them, and then see the authors, this project's measured results, and Anthropic's published benchmarks.

**Work in progress.** All 180 runs are recorded and the game works locally in all five modes. It is not deployed yet, and the measured results are not written up here yet.

- Design: [docs/PLAN.md](docs/PLAN.md) (Sections 0 and 0.1 are the current design)
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

## Tests

```
pnpm test             # unit, component, and service tests (web and Python)
pnpm test:e2e         # plays a round of every mode in Microsoft Edge, against a production build
```

Inspired by golden-age detective fiction.
