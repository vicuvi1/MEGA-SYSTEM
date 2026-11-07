# Builder brief template

Keep briefs to these four parts. Shared rules live in `AGENTS.md`, the shipping steps in the `ship`
skill, and the docs in `docs/INDEX.md`. Don't repeat them in the brief.

```
Agent: builder (Sonnet) | architect (Opus)      Worktree: yes

GOAL
<one or two sentences, in the user's words if possible>

SCOPE
Area doc: docs/areas/<area>.md
Owns: <files/folders this builder may change>
Don't touch: <files other builders own right now>

ACCEPTANCE
- <observable behaviour 1>
- <observable behaviour 2>
- Honest points / security / sync notes if relevant

TESTS
- Unit: <module>.test.ts (pinned clock if time-based)
- Smoke: SMOKE_ONLY="<step words>"   (add/update a step if UI changes)
- Bundles: build:bot / build:sport if applicable

Finish with the ship skill. Report ≤ 250 words, screenshots to <scratchpad>/<folder>/.
```
