# Measuring context and token use

Savings are **estimates until they are measured**. Use `scripts/measure-usage.py`. It works offline
from the Claude Code transcripts in `~/.claude/projects/*MEGA-SYSTEM*/`, plus any agent transcript
paths you pass it.

## What to record for each session or agent
| Metric | Source |
|---|---|
| Cache reads, cache writes, input and output tokens, average context per turn | `measure-usage.py` (the `usage` fields in the transcript) |
| Model mix (turns per model) | `measure-usage.py` |
| Wall time | `measure-usage.py` (first to last timestamp) |
| Tool calls, big-file reads (`AI_HANDOFF.md`, `DesktopIsland.tsx`, `webBots.ts`, `smoke.mjs`, the sport and finance apps), smoke runs | `measure-usage.py` |
| Test pass rate, first-try CI/release pass, retries | `bash scripts/release-status.sh`, plus "passed on try 2" lines in smoke logs |
| Quality | [evaluator-rubric.md](evaluator-rubric.md) score for the same task |

## Baseline (before Phase 1, measured 2026-11-07)
- **Main coordinator session:**
  - 3,609 turns over about 54 h.
  - Cache read 1.70B, cache write 12.9M, input 8.1k, output 4.25M.
  - Average context about 474k per turn.
  - Model: 100% Opus.
  - 119 agents spawned.
  - Big-file reads: AI_HANDOFF 22, webBots 59, smoke.mjs 71, DesktopIsland 37, sport/index.html 20.
- **One builder (focus loop):**
  - 367 turns over 212 min.
  - Cache read 125.7M, cache write 1.95M, output 391k.
  - Average context about 348k per turn.
  - 22 smoke runs. AI_HANDOFF read 3 times, smoke.mjs 20 times.
- **Builders in general:** 280k–560k "subagent tokens" each (from the task notices). Idea-list agents used 100k–123k for 7 tool calls each.
- **Release:** the Sport Track smoke step was flaky on the Windows runner. Recent green runs needed a retry.

## How to compare after a change
1. Run the [controlled comparison tasks](model-routing.md#controlled-comparisons-measure-before-trusting-a-downgrade) from the same commit.
2. `python3 scripts/measure-usage.py <agent transcript>` for each run. For a main session, use `--since <start time>`.
3. Compare the averages for context per turn, cache reads, smoke runs, big-file reads and wall time. Keep the change only if the rubric score and first-try pass rate hold.
4. Add a dated row below.

| Date | Change | Task | Model | Turns | Cache read | Output | Wall | Smoke runs | Rubric | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-07 | baseline | focus-loop builder | Opus | 367 | 125.7M | 391k | 212 min | 22 | — | before Phase 1 |
