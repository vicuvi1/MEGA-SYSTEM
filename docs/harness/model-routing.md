# Model routing

Pick the cheapest option that can do the job well. Set the model **explicitly** on each agent: use a
project agent from `.claude/agents/` (its `model:` frontmatter), or pass `model` on the Agent call.
This never changes the user's default model. Running agents are never switched mid-task.

| Task | Use | Why |
|---|---|---|
| Release/CI status, the failed step of a run, git facts | `bash scripts/release-status.sh` (`fail` for the ✗ lines). No agent | Deterministic and free |
| Read a log, count/list things, collect paths, format a list or table | `status-checker` (**Haiku**) | Simple gathering |
| Routine UI change, test or smoke-step update, a clear feature with a brief | `builder` (**Sonnet**) | Most implementation work |
| Brainstorm or idea lists against the docs | **Sonnet**, briefed with INDEX + one area file | Doesn't need Opus |
| Architecture, security, data sync and conflicts, planner or Ben-brain logic, honest points, cross-area integration, risky reviews, merge decisions | `architect` (**Opus**) | Mistakes here are expensive |
| Coordinating the session, final judgement on a builder's risky change | Main session (the user's chosen model) | — |

**Escalate** Sonnet → Opus when a builder reports "needs a design decision", fails the same
check twice, or touches a security or sync file. Don't rerun the whole task on Opus; ask the
`architect` for the decision, then let the builder continue.

## Controlled comparisons (measure before trusting a downgrade)
Run each task twice from the same commit, once on Sonnet and once on Opus, with the same brief.
Compare tokens, wall time, checks passed on the first try, and the rubric score
([evaluator-rubric.md](evaluator-rubric.md)). Measure with `scripts/measure-usage.py`.
1. **Small UI fix:** "Settings → Look: show the current zoom % next to the slider." Area: workflow. Acceptance: visible value, smoke step, no other changes.
2. **Medium feature with logic:** "Add a 'protein left today' line to the Telegram morning brief." Areas: ben and health. Acceptance: unit test with a pinned clock, honest numbers, `build:bot`.
3. **Read-only gathering:** "List every synced settings key added in the last 7 days with the commit that added it." Haiku compared with Sonnet. Acceptance: complete and correct list.

Keep a downgrade only if the cheaper model's rubric score is no more than 1 point lower and
first-try checks still pass. Record each result in [measurement.md](measurement.md).
