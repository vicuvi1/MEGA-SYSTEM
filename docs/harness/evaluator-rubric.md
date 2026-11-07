# Evaluator rubric

Use this to score one session's or one builder's output before it is accepted. Score each line
0, 1 or 2.

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| **Correctness** | Breaks something, or does the wrong thing | Mostly right, with edge cases missed | Does exactly what was asked, and edge cases are handled |
| **Verification** | Not run | Unit tests only | Typecheck, tests and smoke, with a smoke step for UI changes, and screenshots reviewed |
| **Scope discipline** | Touches unrelated areas or other builders' files | Small extra changes, explained | Only what was asked; shared files get small, additive edits |
| **Reliability** | Depends on the time of day, the network or order (flaky) | Mostly stable | Pinned clocks, robust waits, works on the slow Windows runner |
| **Honesty and safety** | Pays points for things not done, leaks data, or weakens a security rule | Minor slips | Points honest, no secrets or personal data, security rules intact |
| **Handoff readiness** | No notes | Commit message only | Report, docs (`AI_HANDOFF.md`), `progress.md` and `feature_list.json` updated |

**Verdict**
- **Accept:** 10 or more, with no 0 anywhere.
- **Revise:** 7–9, or a single 0 in Scope or Handoff.
- **Block:** any 0 in Correctness or Honesty and safety, or a total under 7.

## Tuning log
Record each change to this rubric and why. Calibrate it against the owner's own judgment for the
first 3–5 reviews.
- 2026-11-07: first version. "Honesty and safety" was added because honest points and public-repo
  privacy are hard rules here.
