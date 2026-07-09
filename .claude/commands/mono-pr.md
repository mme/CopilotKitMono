---
description: Open cross-linked upstream PRs for the current mono branch
---

Open upstream PRs for the current mono branch.

1. Run `pnpm mono:status` and read it carefully.
2. A PR is warranted **only** for a repo whose upstream branch exists and
   actually differs from upstream main. Never open a PR for an unchanged repo.
3. If there are unpushed subtree changes, run `pnpm mono:push` first.
4. For each repo needing a PR: write an upstream-facing title and body (the
   reviewer has no mono-repo context), save the body to a temp file, then run
   `pnpm mono:pr --repo <name> --title "<title>" --body-file <file>`.
5. If PRs exist in both repos, cross-link them: `pnpm mono:pr --link`.
6. If one PR depends on the other, state the dependency and required merge
   order in BOTH bodies, and note that the dependent PR's CI stays red until
   the dependency merges and releases.
7. Report the PR URLs.

$ARGUMENTS
