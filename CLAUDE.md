# CLAUDE.md

## What this repo is

CopilotKitMono is a meta-workspace for developing
[CopilotKit](https://github.com/CopilotKit/CopilotKit) and
[ag-ui](https://github.com/ag-ui-protocol/ag-ui) together, live-linked through a
pnpm workspace. The model in three sentences:

1. **`main` carries the scaffold plus the latest vendored sources** —
   `CopilotKit/` and `ag-ui/` live on `main` as subtree merges with full
   upstream history, kept current by the scheduled `mono-sync` workflow
   (hourly; `pnpm mono:sync` runs the same thing locally).
2. **Feature branches are plain branches off `main`.** All development happens
   on feature branches; creating one is instant.
3. **Branches are ephemeral.** Work ships as native upstream branches/PRs;
   after the PRs land, `mono-sync` brings the merged work back into `main`
   and the branch is deleted.

Two invariants keep this sound: vendored paths on `main` change **only**
through `mono-sync` (human PRs touching them are CI-rejected), and `main` is
**never force-pushed or rewritten** — the vendored history is permanent
shared ancestry.

## Commands

Prefer these over raw git plumbing (they add the safety checks):

| Command | What it does |
|---|---|
| `pnpm mono:branch <name> [--from]` | new feature branch off current `main` (`--from`: join existing upstream branch `<name>` by merging it in) |
| `pnpm mono:sync` | update `main`'s vendored dirs from the upstream defaults (normally done by the `mono-sync` workflow) |
| `pnpm mono:push [--force]` | translate each changed subtree into upstream-native commits, push as branch `<name>` |
| `pnpm mono:pull` | merge commits others pushed to our upstream PR branches |
| `pnpm mono:pull main` | merge upstream `main` into the vendored dirs |
| `pnpm mono:pr [--repo <name>] [--title <t>] [--body-file <f>] [--link]` | open / cross-link upstream PRs |
| `pnpm mono:status` | dashboard: per-repo changes, push state, PR + CI state |
| `pnpm mono:finish [--yes] [--force]` | after PRs merge/close: verified deletion of local, origin, and upstream branches |

Dev loop: `pnpm dev:packages` (terminal 1) + `pnpm dev:demo` or `pnpm dev:dojo`
(terminal 2). The demo needs `OPENAI_API_KEY` in
`CopilotKit/examples/v2/react/demo/.env.local`.

## How it works under the hood

Know this so you can answer questions and handle cases the scripts don't cover
using raw `git`/`gh`. The repo registry is `mono.config.json` (remote names
`copilotkit`, `ag-ui`).

- `mono:sync` = per repo either the initial subtree-merge vendor commit
  (`git merge -s ours --no-commit --allow-unrelated-histories <tip>` +
  `git read-tree --prefix=<dir>/ -u <tip>` + commit, never squashed) or an
  incremental `git merge -X subtree=<dir> <tip>`. Real upstream history is
  ancestry of `main`, so `git log` / `git blame` inside vendored dirs are
  truthful everywhere. Conflicts can't happen: prefixes are disjoint and only
  the bot writes vendored paths on `main`.
- `mono:branch` = fast-forward `main` from origin + `git checkout -b`. With
  `--from`, upstream branch `<name>` is merged into the vendored dir(s)
  (`git merge -X subtree=<dir>`), so the cut-line lands on that branch's tip.
- The **cut-line** (where upstream ends and our work begins) is stored nowhere;
  it is `git merge-base HEAD <remote>/<branch-or-default>`. Our commits for one
  repo: `git log <cut-line>..HEAD -- <prefix>/`.
- `mono:push` = split via `josh-filter
  ':rev(<=<cut-line>:prefix=<dir>):/<dir>'` (the vendored upstream commits map
  to themselves — identical SHAs — and only our commits are re-minted as
  upstream-rooted twins: same messages/authors, different SHAs), then
  `git push <remote> <split-sha>:refs/heads/<branch>`. The split takes
  seconds, is deterministic for a given josh version (pin it — see README),
  and re-pushing fast-forwards. The script also verifies the split tip's tree
  equals `HEAD:<dir>` before pushing, and afterwards records the pushed tip as
  an empty `-s ours` merge (`Record split of '<dir>/' as <sha>`) so the twins
  are ancestors of the mono branch — that's what makes later `mono:pull`s
  merge only genuinely new upstream commits instead of conflicting with your
  own changes. Re-push the mono branch (`git push origin <branch>`) after
  `mono:push` to share the marker. Never use `git subtree split` here — it
  walks the entire vendored history with a subprocess per commit (~45 min)
  and segfaults bash 5.3.
- `mono:pull` = `git merge -X subtree=<dir> <remote-tip>` — a real merge of
  real upstream commits (never squashed); conflicts are normal merge
  conflicts.
- Upstream PR/issue work: `gh --repo <ghRepo> …`, where `<ghRepo>` comes from
  `mono.config.json` — the registry is the single source of truth for every
  repo address; never hardcode repo slugs from memory or docs.

## Rules

- **Commit messages are upstream-facing.** They become upstream commits
  verbatim, read by reviewers with zero mono-repo context. A commit touching
  both repos becomes two upstream commits sharing one message — if the message
  can't stand alone in both repos, split the commit. Prefer per-repo commits.
- **Append-only after `mono:push`.** Rebasing/amending pushed commits forces a
  force-push upstream — warn first, never do it casually.
- **Never merge a feature branch into `main`, and never edit vendored paths
  on `main`.** Vendored code reaches `main` only via `mono-sync` (after
  landing upstream). Scaffold changes travel on plain branches via normal PRs
  to this repo — the `mono-main-guard` workflow rejects PRs touching vendored
  paths.
- **Never force-push or rewrite `main`.** Its vendored history is shared
  ancestry for every branch and clone.
- **Never let git-lfs touch this repo.** It is pointer-only (no LFS storage);
  one LFS-enabled client contact permanently flips GitHub into rejecting all
  vendored pushes. If git-lfs is installed: `GIT_LFS_SKIP_SMUDGE=1` for
  clones and `git lfs uninstall --local` in every clone before pushing.
- **PR discipline**: open a PR only for a repo whose branch actually differs
  from its upstream main; cross-link companion PRs in both bodies
  (`pnpm mono:pr --link`); when one PR depends on the other, state the
  dependency and merge order in both bodies and note the dependent PR's CI
  stays red until the dependency merges **and releases** (upstream CI installs
  published packages, not workspace links).
- Do not add `Co-Authored-By` lines to commits.

## Key paths

- CopilotKit packages: `CopilotKit/packages/*` (flat — `@copilotkit/*` and
  `@copilotkitnext/*` live side by side; check each `package.json` for the
  scope)
- ag-ui TS SDK: `ag-ui/sdks/typescript/packages/*` · integrations:
  `ag-ui/integrations/*/typescript` · middlewares: `ag-ui/middlewares/*`
- Demo app: `CopilotKit/examples/v2/react/demo/`
- Root `pnpm-workspace.yaml` is generated from the vendored repos' own
  workspace files by `scripts/mono/sync-workspace.mjs` (run by `mono:sync`);
  if upstream's layout changes mid-branch, re-run it instead of hand-editing.
