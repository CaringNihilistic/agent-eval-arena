# Findings

Things learned about models and providers while building and running the arena. Each entry is backed by a recorded response or trace in this repository. Entries marked **README** belong in the results section of the final README.

## 1. gpt-oss-120b on Groq cannot use a custom code tool (README)

**Observed 2026-10-02**, model `groq/openai/gpt-oss-120b`, Groq free plan.

**What happens.** Given a task that needs code and a tool named `python_exec`, the model does not call `python_exec`. It calls `python`, a tool built into the model, and writes raw code where JSON arguments belong:

```
{"name": "python", "arguments": import pandas as pd, io, sys, ...
```

Groq rejects the whole response with HTTP 400, code `tool_use_failed`, message "Model called python tool which was not enabled for this request". No usable output reaches the agent loop.

**It persists after correction.** The arena tells the model that the response was rejected and lists the tools that exist. The model makes the same call again. In one run it repeated the call six times in a row. Adding "there is no tool named python" to the `python_exec` description did not change this either.

**It burns the rate limit.** Rejected responses still count against Groq's tokens-per-minute limit. The run that repeated the call six times ended in an HTTP 429.

**It is specific to code.** On the same day the same model used `calculator`, `read_file`, `search_docs`, and `submit_answer` correctly, and passed the arithmetic and document tasks.

**Reproduced** on every one of four attempts at the code task.

**What the arena does about it.**

- A provider-rejected tool call is reported to the model and uses a step, the same outcome a model gets on other providers when it calls a tool that does not exist. After three in a row the run ends as an agent error.
- gpt-oss-120b was replaced by `qwen/qwen3.8-27b` for the Groq configs, because a model that cannot run code would make the tools comparison (all four tools against two) meaningless on data tasks. Qwen passed all three development tasks with correct tool calls.

**Evidence.**

- `docs/findings/gpt-oss-120b-python-tool/provider-error.txt`: Groq's error, including the rejected generation.
- `docs/findings/gpt-oss-120b-python-tool/trace.ndjson`: the full trace of a run that ends after three rejected calls.
- `apps/api/tests/test_real_provider_responses.py`: regression tests built from that error.

## 2. Gemini's free tier refuses most requests under load, and allows 20 a day

**Observed 2026-10-02**, model `gemini/gemini-3.8-flash`, free tier.

- About 8 of 11 run attempts ended at the first request with HTTP 503, "This model is currently experiencing high demand". No tokens were used.
- The owner's AI Studio dashboard shows the free-tier limits for this model as 5 requests per minute, 250,000 tokens per minute, and **20 requests per day**.
- When a request was served, tool calling worked without problems, including the thought signature that must be returned unchanged on the next request. One first request took 26 seconds.

**What the arena does about it.** A 503, like a rate limit, abandons the run so it is re-run; it is never recorded as an agent failure. The recorder will track the outage and retry rate per provider and report it in the pilot.

**Consequence.** At about three requests per run, 20 requests a day is six or seven runs a day. Sixty Gemini runs would take about ten days before counting refused requests. See `PLAN.md` Section 8.

## 3. Provider tool-call ids identify the provider

**Observed 2026-10-02.** Gemini's tool-call ids embed an encrypted thought signature hundreds of characters long (`call_…__thought__…`), and Groq's start with `fc_`. Shown in a trace, either would tell a voter which provider a pane is. The trace uses its own ids (`call_1`, `call_2`); provider ids stay only in the conversation sent back to the provider.

## 4. Groq's published and enforced limits differ

**Observed 2026-10-02.** Groq's rate-limit page lists 8,000 tokens per minute for `qwen/qwen3.8-27b`. The 429 the API returned names a limit of 7,000 **input** tokens per minute. Two runs back to back exceed it; the recorder has to pace on the enforced figure.

## 5. The Claude Agent SDK adds context and settings of its own (README)

**Observed 2026-10-02**, Claude Agent SDK 0.2.163, Claude Code 2.1.286, subscription login.

With a custom system prompt, every built-in tool removed, and no settings loaded, each request still carried:

- two extra system-prompt blocks ahead of ours: a billing header line, and "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
- three `<system-reminder>` blocks ahead of the task: the environment, the model's name and knowledge cutoff, and today's date;
- `max_tokens` of 32,000 and extended thinking with a 31,999-token budget, on every model including Haiku;
- prompt caching with a one-hour lifetime.

The tools are exactly ours, renamed `mcp__arena__<name>`.

**What could be brought in line.** The arena now sets `max_tokens` to 1,024, the same per-call cap the other configs have, and turns thinking off on Haiku 4.5. A fresh captured request per model confirms both.

**What could not.**

- **Opus 5.5 and Sonnet 5.5 cannot have thinking turned off.** They run at the lowest effort setting instead, so they still reason before answering and Haiku does not.
- **The added system-prompt and reminder blocks stay.** No setting removes them on a subscription login.
- **About 1,450 input tokens of fixed overhead per request**, mostly the tool-use preamble and tool schemas.
- **Prompt caching stays on.**

**Consequence.** Claude configs do not run under identical request conditions to the Gemini and Qwen configs. This is part of the loop confound between backends and is why matches and the Elo board are kept within a backend. For `/about`: say that Claude configs run Claude Code's loop, list the four differences above, and link to the captured requests.

**Evidence.** `docs/findings/claude-agent-sdk-request/` holds the first request of a run for each of the three models, with the account identifier removed.

## 6. No free Gemini model offers more than 20 requests a day to this account

**Observed 2026-10-02.**

| Model                                       | Result                                                                                                                                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gemini-3.8-flash`                          | 20 requests a day (owner's AI Studio page). Tool calls work.                                                                                                                                                                  |
| `gemini-3.5-flash`                          | 20 requests: the API's 429 reads "Quota exceeded for metric: generate_content_free_tier_requests, limit: 20". Tool calls work; it passed two development tasks before the quota ran out. Requests took 10 to 15 seconds each. |
| `gemini-3.7-flash`                          | Passed the one task it was run on. Its limit is visible only in AI Studio.                                                                                                                                                    |
| `gemini-3.6-flash`                          | Not run to completion. Its limit is visible only in AI Studio.                                                                                                                                                                |
| `gemini-2.5-flash`, `gemini-2.5-flash-lite` | HTTP 404: "no longer available to new users".                                                                                                                                                                                 |

Requests refused with HTTP 503 appear to count against the daily quota: `gemini-3.5-flash` reported its 20-request limit reached after about ten served requests and several refused ones.

## 7. gpt-oss-20b uses the code tool that gpt-oss-120b cannot

**Observed 2026-10-02**, `groq/openai/gpt-oss-20b`, Groq free plan. On the same code task where gpt-oss-120b calls its built-in `python` tool every time (entry 1), the 20b model called `python_exec` with valid arguments and answered correctly. It is less steady in other ways: one run produced a malformed tool name (`submit_answer<|channel|>commentar…`), which Groq rejected and the arena's recovery handled, and one run wandered for seven steps until it hit the per-minute token limit.

## 8. One run can exceed Groq's per-minute limit by itself

**Observed 2026-10-02**, `groq/qwen/qwen3.8-27b`. A single four-step run used 7,230 tokens, over the 7,000 input tokens a minute Groq enforces, and was cut off even with 45 seconds between runs. Spacing runs apart is not enough: the recorder has to pace individual model calls.
