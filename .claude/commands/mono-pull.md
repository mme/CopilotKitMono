---
description: Pull upstream changes (PR-branch commits or upstream main) into the mono branch
---

Pull upstream movement into the current mono branch.

1. Decide the target from the user's intent: `pnpm mono:pull` for commits
   reviewers pushed to our PR branches (default), `pnpm mono:pull main` to
   catch up with upstream main.
2. Working tree must be clean first — propose committing if not.
3. On merge conflicts the script stops mid-merge like git does: resolve the
   conflicts with the user, then `git commit` to conclude, and mention
   `pnpm install` if dependency files changed.
4. Summarize what came in per repo (git log of the newly merged range).

$ARGUMENTS
