---
description: Clean up a finished mono branch (verified, guarded)
---

Finish the current mono branch.

1. Run `pnpm mono:status` and confirm every pushed repo's PR is MERGED or
   CLOSED. If any PR is still open, stop and tell the user — do not finish.
2. Run `pnpm mono:finish`. If it reports that confirmation needs a terminal, show the user exactly what it plans to delete, get their explicit confirmation in chat, then re-run with `--yes`. Relay any other prompts or refusals faithfully.
3. If it refuses, explain exactly which check failed and the next step.
   Never suggest `--force` unless the user explicitly wants to abandon work.

$ARGUMENTS
