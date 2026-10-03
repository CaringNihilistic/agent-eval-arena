# Findings

Things learned about models and providers while building and running the arena. Each entry is backed by a recorded response or trace in this repository. Entries marked **README** belong in the results section of the final README.

## Headline: the same model, the same task, a different score

**Three identical runs of every model on every task, all on 2026-10-02.** Same prompt, same tools, same settings, 270 runs. Detail in entry 10.

| Model      | Tasks whose score changed between runs | Mean gap, best to worst run of a task | Whole-bank score, lowest to highest run |
| ---------- | -------------------------------------- | ------------------------------------- | --------------------------------------- |
| Haiku 4.5  | 9 of 30                                | 9.0 points                            | 88.0% to 93.7%                          |
| Sonnet 5.5 | 5 of 30                                | 3.2 points                            | 95.2% to 97.5%                          |
| Opus 5.5   | 4 of 30                                | 3.1 points                            | 95.8% to 97.5%                          |

- **Sonnet and Opus cannot be ranked by this scorer.** Over all runs they score 96.6% and 96.5%. Each moves about two points between identical runs, more than twenty times the gap between them, and which one is ahead changes with the run: Sonnet led in the first, Opus in the third.
- **Haiku is separated from the other two, and is the least steady.** Its best run (93.7%) is below their worst (95.2%), and it changed score on nearly a third of the tasks.
- **All of the movement is in the open-ended tasks.** No model's pass or fail on any code or agent task changed in three runs. What moves is whether a letter kept to its stated rules.
- **One run is not a measurement.** The first run alone had Haiku meeting 85 of 101 rules, 11 to 13 behind the others. The next two had it at 97 and 95, level with them.

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

## 7. Checkpoint A pilot: four Claude runs on the revised bank

**Observed 2026-10-02.** One run each, on the subscription, actual cost $0.

| Config               | Task                            | Result                    | Model calls | Tokens | Active time | Answer   |
| -------------------- | ------------------------------- | ------------------------- | ----------- | ------ | ----------- | -------- |
| `claude-haiku-full`  | `writing-04` (story opening)    | Constraints met 6/6       | 2           | 3,584  | 4.4 s       | 53 words |
| `claude-sonnet-full` | `diagram-03` (sequence diagram) | Constraints met 4/4       | 1           | 1,764  | 2.4 s       | 12 lines |
| `claude-opus-full`   | `code-04` (merge intervals)     | Pass, 8 of 8 hidden tests | 1           | 1,684  | 3.8 s       | 9 lines  |
| `claude-opus-full`   | `agent-03` (multi-hop)          | Pass, 71                  | 3           | 5,677  | 7.6 s       | 1 word   |

- **No run came near the 16,000-token cap.** The largest used 35% of it.
- **Fixed cost per model call is about 1,400 input tokens**, and it dominates: 74% to 83% of each run's tokens. Most of that is not Claude Code's doing. By the size of each part in the captured requests, about 55% is the tool definitions and 17% the arena's system prompt, which every config on either backend sends; about 20% (the billing line, the identity line, and the environment and date reminders, roughly 170 to 200 tokens a call) is added by Claude Code. So the harness accounts for roughly a tenth of a Claude run's tokens. This is an estimate from character counts, not a token count.
- **Haiku ran code to check its word count before submitting** the story opening. Tools are not inert on writing tasks.
- **Four runs say nothing about quality or separation.** All four results were clean; whether the bank separates configs is a question for the full recording and the votes.

## 8. The full recording: 90 runs, three Claude models

**Recorded 2026-10-02**, one run per model per task, on the subscription. Actual cost $0.

| Model      | Code and agent tasks passed | Constraints met (open-ended) | Tokens, all 30 runs | Largest run | Mean active time | Cost at API rates |
| ---------- | --------------------------- | ---------------------------- | ------------------- | ----------- | ---------------- | ----------------- |
| Haiku 4.5  | 9 of 10                     | 85 of 101                    | 117,632             | 9,743       | 5.7 s            | $0.18             |
| Sonnet 5.5 | 10 of 10                    | 98 of 101                    | 66,442              | 5,615       | 4.1 s            | $0.14             |
| Opus 5.5   | 10 of 10                    | 96 of 101                    | 67,024              | 5,678       | 4.6 s            | $0.28             |

- **The pass/fail tasks barely separate the models.** One failure in 30 scored runs: Haiku on `agent-01`. The scorer cannot rank Opus against Sonnet on these tasks; that is left to the votes.
- **Where the constraint checks differ.** Diagrams: all three met every check. Tech stack: Haiku 25 of 35, the others 35 of 35. Writing: Haiku 25 of 29, the others 29 of 29. Explanation: Haiku 18 of 20, Sonnet 17, Opus 15.
- **Haiku's missed constraints are mostly a habit, not the content.** It often replies in plain text with a preamble ("Perfect! All requirements are met. Here's the email:") instead of submitting the answer alone, which breaks checks such as "starts with 'Subject:'". The preamble is part of its final answer and voters see it.
- **Haiku uses about 1.75 times the tokens of the other two.** It took 58 model calls over 30 tasks against 37 each for Opus and Sonnet: it calls tools to check its work, the others mostly answer in one call.
- **Token cap.** No run reached the 16,000-token cap, and every run ended by answering.
- **Thinking.** Haiku and Sonnet produced no thinking block. Opus produced one on 2 of its 37 model calls. The blind view hides them.
- **Usage.** The 90 runs took about 10 minutes of run time and did not reach a subscription usage limit.

**Harness overhead, from a request captured during this recording** (`claude-haiku-full` on `writing-01`, first model call). The API counted 1,468 input tokens. The request held 3,667 characters of text, of which Claude Code added 767 (21%): a billing line (191), an identity line (62), and three reminder blocks giving the environment, the model's name, and the date (514). The arena's own content was the tool definitions (1,897 characters), the system prompt (573), and the task (430). Character counts are measured; a token count per part is not available without the tokenizer, so in tokens the harness share is an estimate of roughly 200 per model call, about a tenth of a typical run. It is the same for all three models, so it does not affect the comparison between them.

**One thing the harness adds that matters for blind voting.** One reminder block tells the model its own name ("You are powered by the model named Haiku 4.5"). A model could repeat that in an answer. None did in these 90 runs: the leak scan over every blind match checks for each model's name.

## 9. The second runs: how much one model varies from run to run

**Recorded 2026-10-02.** A second run of every model on every task, same settings, for the impostor rounds. Actual cost $0.

| Model      | Code and agent passed, run 1 / run 2 | Rules met (open-ended), run 1 / run 2 | Tokens, run 1 / run 2 |
| ---------- | ------------------------------------ | ------------------------------------- | --------------------- |
| Haiku 4.5  | 9 of 10 / 9 of 10                    | 85 of 101 / 97 of 101                 | 117,632 / 125,961     |
| Sonnet 5.5 | 10 of 10 / 10 of 10                  | 98 of 101 / 97 of 101                 | 66,442 / 66,539       |
| Opus 5.5   | 10 of 10 / 10 of 10                  | 96 of 101 / 96 of 101                 | 67,024 / 64,684       |

- **Haiku's rule-keeping moved by twelve checks between two runs of the same thing.** Run 1 put it clearly behind the other two on open-ended tasks; run 2 puts it level with them. The site's totals use run 1, so they understate how close Haiku can be. One run per task is a thin basis for the open-ended comparison, and this is the evidence.
- **Scores differed between the two runs on 14 of 90 model-task pairs:** 9 for Haiku, 3 for Sonnet, 2 for Opus.
- **One run hit the token cap.** Haiku's second run of `agent-01` used 18,799 tokens and stopped at the 16,000 cap: it tried to read the data file by a full path that the sandbox does not have, and spent its budget on the errors. It is the only one of 180 runs that did not end by answering.
- **A leak the tests caught.** That same run wrote the path of its working folder into a tool call, and the folder's name contained the harness's name. The blind view now replaces the folder name, and new runs use a neutral one. See DECISIONS.md.
- **Two runs by one model can be word-for-word the same.** On some code tasks both of Opus's answers are identical, so an impostor round there shows the same letter twice. That is a fair clue, not a bug.
- **Usage.** The 90 runs took about 9 minutes and did not reach a subscription usage limit.

## 10. Three runs: totals, variance, and what holds

**Recorded 2026-10-02, in three passes.** Actual cost $0; $1.84 at API rates for all 270 runs.

| Model      | Code and agent passed, runs 1 / 2 / 3 | Rules met of 101, runs 1 / 2 / 3 | Tokens, runs 1 / 2 / 3      |
| ---------- | ------------------------------------- | -------------------------------- | --------------------------- |
| Haiku 4.5  | 9 / 9 / 9 of 10                       | 85 / 97 / 95                     | 117,632 / 125,961 / 119,794 |
| Sonnet 5.5 | 10 / 10 / 10 of 10                    | 98 / 97 / 94                     | 66,442 / 66,539 / 66,540    |
| Opus 5.5   | 10 / 10 / 10 of 10                    | 96 / 96 / 98                     | 67,024 / 64,684 / 66,773    |

- **Which tasks moved.** Haiku: three explanation tasks, four tech-stack tasks, two writing tasks; the largest gap was 50 points, on `writing-04`. Sonnet: two explanation, two tech-stack, one writing. Opus: three explanation, one writing. `writing-01` moved for all three.
- **Haiku fails `agent-01` every time, in two different ways.** In run 1 it answered wrongly. In runs 2 and 3 it ran into the 16,000-token cap without answering: the only two of 270 runs that did not end with an answer.
- **Token use is steady.** Sonnet's three runs of the bank are within 100 tokens of each other; Opus's within 4%; Haiku's within 8%.
- **What holds.** 223 of 270 runs passed their tests or met every rule; 47 did not. Of the 47, 30 are explanation tasks (Opus 12, Sonnet 10, Haiku 8), 10 tech-stack (Haiku 7, Sonnet 3), 4 writing, and 3 are Haiku on `agent-01`. Opus misses a rule on explanation tasks more often than Haiku does.
- **Usage.** Each recording of 90 runs took about 9 minutes and none reached a subscription usage limit.

## 11. A health check that looked like an escaped process

**Found 2026-10-02.** One sandbox test failed once in a full test run and passed when re-run.

- **Not what it looked like.** The test checks the Mermaid parser, so a timeout under load was the obvious guess. The suite then passed 10 of 10 while the web and API suites ran beside it.
- **The saved output had the answer.** The assertion that failed was "no process is left behind", and what was left was one unexpected process id.
- **Cause.** Docker runs the container's health check by starting a process inside it every five seconds, as the sandbox's own user. The sandbox's check for processes left behind by executed code counted it. Calling the check in a loop for 22 seconds found a stray in 8,048 of 257,809 calls, 3.1%.
- **It was not only a test problem.** The live sandbox kills what it takes for strays, so it had been killing its own health check about 3% of the time.
- **Fix.** A process started from outside the container has a parent the container cannot see. The check now recognises those and leaves them alone. Code the sandbox runs cannot get such a parent. After the fix: 0 strays in 161,210 calls.
- **A second fault found on the way.** A Mermaid parser that timed out was reported as "the diagram is invalid". On a slow machine that would have scored a valid diagram as failing, with nothing to show it. It is now an error, and the run is left unscored and re-run. No recorded run was affected.

## 12. The step count named the author

**Found by the owner, 2026-10-03, before launch.** A blind letter showed "How it was written (N steps)" and, folded away, its trace: a heading for each step and every tool call. Over the 270 runs, Haiku 4.5 averages 1.89 steps per task (170 model calls), against 1.23 for Sonnet 5.5 (111) and 1.22 for Opus 5.5 (110). Haiku checks its own work with tools before answering, and the other two mostly answer in one call. So a letter that took two or three steps was very likely Haiku's, and a player could have learned that without reading a word of it.

- **Why the redaction missed it.** The blind view removed everything that measures cost or time, but the number of steps is neither. It is behaviour, and here behaviour differs by model.
- **Fix.** Before a decision the server sends each letter's seat, guest, and final answer, and nothing else. The trace and its step count are sent with the reveal. The service test checks the exact fields of every blind letter in every mode, and Playwright checks that no blind letter shows its working.
- **What it shows about blind evaluation.** Anything that differs systematically between models can identify them, not only names and prices. Answer length and style still can, and the About page says so.
