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
