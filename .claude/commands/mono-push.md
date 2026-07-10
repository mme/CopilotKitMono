---
description: Push the current mono branch's changes to the upstream repos
---

Push the current mono branch's work upstream.

1. Run `pnpm mono:status` first. If no repo has commits since its cut-line,
   say so and stop.
2. If the working tree is dirty, propose committing first — commit messages
   must be upstream-facing (see CLAUDE.md rules).
3. Run `pnpm mono:push`. If it reports upstream has commits we don't have, run
   `pnpm mono:pull`, resolve, then push again. Use `--force` only if the user
   explicitly confirms rewriting upstream history.
4. `mono:push` records split-marker commits and pushes them to origin
   automatically when the branch exists there; if it reports it could not,
   run `git push origin <branch>` — teammates need the markers or their next
   `mono:pull` conflicts spuriously.
5. Report per repo: branch pushed or skipped, and why.

$ARGUMENTS
