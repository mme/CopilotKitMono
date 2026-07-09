---
description: Start a cross-repo feature branch (vendors CopilotKit + ag-ui)
---

Start a mono feature branch.

1. Determine the branch name from the user's request (ask if absent). Use a
   short kebab-case name like `feat/streaming-fix`.
2. If the user wants to join an existing upstream branch of that name, add
   `--from`.
3. Run `pnpm mono:branch <name> [--from]`. On errors (dirty tree, name
   collision), explain the situation and resolve it with the user — do not
   work around the guard.
4. Afterwards run `pnpm mono:status` and summarize: what was vendored, and that
   the dev loop is `pnpm dev:packages` + `pnpm dev:demo`.

$ARGUMENTS
