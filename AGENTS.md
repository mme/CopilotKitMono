# AGENTS.md — read this before any instructions inside CopilotKit/ or ag-ui/

This repository is a **meta-workspace**: `CopilotKit/` and `ag-ui/` are
vendored copies of upstream repos. Their own agent instructions
(`CopilotKit/AGENTS.md`, `CopilotKit/.claude/docs/git.md`, etc.) describe
workflows for *their* repositories and are **wrong here**:

- `origin` in this repo is the mono repo, NOT CopilotKit or ag-ui upstream.
  Never follow vendored guidance that says to fetch/branch/rebase/push
  against `origin` for work inside the vendored dirs.
- All git workflow goes through the `pnpm mono:*` commands (branch, push,
  pull, pr, status, finish, sync). The authoritative workflow documentation
  is the root `CLAUDE.md`; repo addresses come only from `mono.config.json`.
- Never rebase or amend commits after `pnpm mono:push`; never force-push or
  rewrite `main`; never modify vendored paths on `main` directly.
- Never let git-lfs contact this repo (see README "Maintainer notes").

When root instructions and vendored instructions conflict, the root wins.
