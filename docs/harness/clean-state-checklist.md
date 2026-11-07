# Clean-state checklist

Run this before you end a session or push to `main`. Every box must be ticked.

- [ ] `bash scripts/init.sh` is green: typecheck and unit tests pass.
- [ ] `npm run smoke` passes, or the one failing step is written in `progress.md` with its
      "waiting for …" line.
- [ ] If bot code changed, `npm run build:bot` was run and `api/_bot/bot.mjs` is committed.
- [ ] If `src/core/sport*.ts` changed, `npm run build:sport` was run and `sportkit.js` is committed.
- [ ] Every new migration appends to `src/core/schema.ts` and bumps `SCHEMA_VERSION` in `api/_schema.mjs`.
- [ ] There are no new files in `api/` (the Hobby plan allows at most 12 functions).
- [ ] There are no secrets, tokens or real personal data in the code, tests, docs or screenshots.
- [ ] `feature_list.json` matches reality: nothing says `passing` without its evidence.
- [ ] `progress.md` has this session's entry, and `session-handoff.md` is written if the work isn't done.
- [ ] There is no half-finished work in the tree. Everything is committed, or stashed and written down.
- [ ] There are no leftover worktrees or branches (`git worktree list`), and `node_modules` was never committed.
- [ ] The next session can start with `bash scripts/init.sh`, with no manual fixes.
