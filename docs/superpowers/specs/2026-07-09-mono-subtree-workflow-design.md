# CopilotKitMono — Ephemeral Subtree Workflow (Design)

**Date:** 2026-07-09
**Status:** Draft for review

## 1. Goal

Let the team develop CopilotKit and ag-ui together in one workspace — live-linked
through pnpm — while branches, sharing, and PRs behave like normal git:

- one command sets up a cross-repo feature branch
- teammates get the exact combined state with plain `git checkout`
- work is pushed directly to new or existing branches on the upstream repos
- upstream movement (including reviewer commits) can be pulled back in
- PRs are opened against both upstreams, cross-linked, with dependency order stated

Consistent naming everywhere: `pnpm mono:*` scripts, `/mono-*` slash commands,
documented in CLAUDE.md and README.

## 2. Core model: ephemeral vendor branches

- **`main` is scaffold only.** It contains workspace config, scripts, docs, CLAUDE.md.
  It never contains `CopilotKit/` or `ag-ui/` sources. Ever.
- **Feature branches vendor the sources.** `pnpm mono:branch feat/foo` creates the
  branch and vendors both upstream repos at their current tips via
  `git subtree add` **without `--squash`** (full real history becomes ancestry of
  the branch). The vendored tip of each repo is the **cut-line**: everything after
  it is "our work".
- **Branches are short-lived.** They exist to develop a feature, push it upstream,
  and die. They are **never merged into `main`** (enforced by CI guard + branch
  protection). Deleting the branch is the cleanup; nothing accumulates on `main`.

Why no `--squash`: real upstream commits in the ancestry make `git blame`/`git log`
truthful, make reviewer-pushed commits round-trippable, and give `git subtree split`
real parents to graft onto. The cost (upstream histories in the mono repo's object
store, shared across branches) is accepted.

Accepted trade-offs (explicitly agreed):

- Rebasing/amending commits already pushed upstream ⇒ force-push upstream. Allowed
  but must be deliberate (CLAUDE.md rule: warn, never rebase pushed work casually).
- Upstream commit SHAs differ from mono commit SHAs (same content/message/author).
- Checking out `main` makes the source dirs vanish from the working tree.

## 3. Repository layout

On `main`:

```
package.json          # workspace config + mono:* scripts
pnpm-workspace.yaml   # package globs for both repos
pnpm-lock.yaml
nx.json / .nxignore
mono.config.json      # the repo registry (see §4)
scripts/mono/         # the mono:* command implementations
.github/workflows/mono-main-guard.yml
.claude/commands/mono-*.md
CLAUDE.md
README.md
docs/
```

On a feature branch, additionally:

```
CopilotKit/           # vendored subtree (full history)
ag-ui/                # vendored subtree (full history)
```

## 4. Configuration — and no state file

**`mono.config.json`** (committed on `main`) — the registry of linked repos, so
adding a third repo later is a config edit, not new code:

```json
{
  "repos": [
    {
      "name": "copilotkit",
      "prefix": "CopilotKit",
      "remote": "git@github.com:CopilotKit/CopilotKit.git",
      "ghRepo": "CopilotKit/CopilotKit",
      "defaultBranch": "main"
    },
    {
      "name": "ag-ui",
      "prefix": "ag-ui",
      "remote": "git@github.com:ag-ui-protocol/ag-ui.git",
      "ghRepo": "ag-ui-protocol/ag-ui",
      "defaultBranch": "main"
    }
  ]
}
```

**There is no state file.** Everything the commands need is derived from regular
git, deterministically, on any clone:

- **Cut-line**: derived structurally — never by parsing commit messages. Because
  vendoring is non-squash, the real upstream commits are ancestors of the branch,
  so the cut-line for a repo is `git merge-base HEAD <remote>/<ref>` (the feature
  branch where it exists upstream, else the default branch; when both exist, the
  descendant-most result wins). At branch creation this equals the vendored tip;
  after a `mono:pull` it advances to the pulled tip — exactly the right semantics,
  for free.
- **Upstream branch name**: always equals the mono branch name, by convention.
  No mapping to store.
- **Everything dynamic** (ahead/behind, pushed-or-not, PR state, CI status) is read
  live from git and `gh`. One source of truth per fact; nothing can go stale.

Scripts add git remotes named after each repo's `name` on demand and fetch them.

## 5. Command set

All commands are Node scripts (zero runtime deps, `child_process` + plumbing git)
in `scripts/mono/`, exposed as `pnpm mono:<cmd>`. Shared behavior: every
state-changing command refuses to run on a dirty working tree, refuses to run on
`main` when it needs a feature branch (and vice versa), and prints what it's about
to do before doing it.

### `pnpm mono:branch <name> [--from]`

1. Requires: on `main`, clean tree, `<name>` is a valid git ref name.
2. Fetches all configured upstreams.
3. Without `--from`: errors if `<name>` already exists on any upstream (protects
   against accidental collision). With `--from`: joins existing work — vendors from
   the upstream branch named `<name>` on each repo where it exists.
4. Creates branch `<name>`; for each repo, `git subtree add --prefix=<prefix>
   <remote> <ref>` where `<ref>` is `<name>` (if `--from` and it exists on that
   repo) else the default branch. No `--squash`.
5. Runs `pnpm install` and commits the lockfile change if any.

### `pnpm mono:push [--force]`

For each repo whose subtree changed since its cut-line:

1. Produce the upstream-native branch: `git subtree split --prefix=<prefix>` —
   deterministic, handles merge commits (needed after `mono:pull` brings in
   reviewer commits). Correctness first; see §6 for the speed lever.
2. Push the split ref to `<remote> <mono-branch-name>`. Fast-forward expected; on
   non-fast-forward, abort with "upstream moved — run `pnpm mono:pull` first"
   (`--force` overrides, printing a loud warning).

Repos with no changes since cut-line are skipped and reported.

### `pnpm mono:pull [main]`

- Default (no arg): for each repo, `git subtree pull --prefix=<prefix> <remote>
  <branch-name>` (no `--squash`) — brings in reviewer commits from the PR
  branches. Repos whose upstream branch doesn't exist are skipped.
- `main`: same but from each repo's default branch — the "catch up with upstream
  main" operation. Conflicts surface as normal merge conflicts.

### `pnpm mono:pr`

Thin `gh` wrapper: for each repo pushed upstream (split ref differs from upstream
default branch), `gh pr create --repo <ghRepo> --head <branch-name>` unless a PR
already exists (then prints its URL). Body authoring/cross-linking is the model's
job via `/mono-pr` (§8); the script accepts `--title`/`--body-file` per repo and a
`--link` flag that appends "Companion PR: <url>" to both bodies after creation.

### `pnpm mono:status`

The dashboard (read-only, safe anywhere):

- current branch, cut-line SHAs
- per repo: commits since cut-line, subtree pushed/unpushed (split ref vs upstream
  branch), upstream branch ahead/behind, PR state + CI status via `gh`
- mono branch: pushed to origin or not

### `pnpm mono:finish [--yes] [--force]`

Guarded cleanup — refuses (with reasons) unless **all** hold:

1. clean working tree, mono branch fully pushed to origin
2. every upstream branch that was pushed has its PR **merged or closed**
   (checked via `gh`); repos never pushed are exempt
3. explicit interactive confirmation after printing the exact deletions

Then: checkout `main`, delete local branch, delete `origin/<branch>`, and offer to
delete the upstream branches (skip any GitHub auto-deleted). `--force` skips check 2 only; confirmation (3) is always required —
interactively, or explicitly via `--yes` for non-interactive runs.

## 6. Push mechanics (the split) and performance

`git subtree split` walks the branch's ancestry and manufactures upstream-native
twins of our commits (prefix stripped, same message/author/order, grafted onto the
real upstream parents it finds in the vendored history). It is deterministic:
re-running regenerates identical SHAs, so successive pushes fast-forward, and two
teammates pushing the same branch produce identical refs.

Because the vendored histories are ancestors, split re-walks upstream commits per
push. v1 ships correctness-first: plain `git subtree split` with no hints — real
ancestry means it grafts onto the true upstream commits automatically, with no
commit-message parsing involved. `mono:push` prints split duration so
slowness is visible, not mysterious. If it proves too slow on real branches, the
documented fallback (not built in v1) is a custom replay of the commits after the
cut-line — deferred because `git subtree split` handles merge commits and edge
cases we would otherwise re-implement.

## 7. Guards

- **CI main-guard** (`mono-main-guard.yml`): on every PR targeting `main`, fail if
  the diff touches `CopilotKit/` or `ag-ui/`. This is the structural
  enforcement of "vendored branches never merge to main".
- **Branch protection** (repo settings, documented in README): `main` requires PRs;
  no direct pushes.
- **Local guards**: scripts refuse to vendor on `main`, refuse dirty trees, validate
  branch names, detect non-fast-forward pushes. Missing tooling (`gh`, `git subtree`)
  surfaces as a clear error at point of use — no separate doctor command.

## 8. Claude integration

**CLAUDE.md** (rewritten) documents:

- the model in three sentences (main = scaffold; branches vendor subtrees; never
  merge to main) and the layout
- **how it works under the hood** (non-squash `subtree add`, `subtree split` for
  pushing, `merge-base` as the cut-line) — so the agent can answer questions and
  handle cases the scripts don't cover by falling back to raw `git`/`gh`
- the `mono:*` commands as *the* verbs — Claude must use them instead of raw
  `git subtree`
- upstream interaction rules: `gh --repo <ghRepo>` for PR/issue operations;
  local `git log`/`blame` are truthful on feature branches
- commit hygiene: messages are upstream-facing (a CopilotKit or ag-ui reviewer
  reads them verbatim, with no mono-repo context); prefer per-repo commits — a
  mixed commit becomes two upstream commits sharing one message, so if a message
  can't stand alone in both repos, split the commit
- append-only rule: never rebase/amend work already pushed upstream without
  flagging that it forces a force-push
- PR discipline (below), dependent-PR CI expectations, dev commands (`dev:packages`,
  `dev:demo`, `dev:dojo`), and the "sources vanish on main" note

**Slash commands** (`.claude/commands/mono-*.md`), thin wrappers that add judgment
on top of the scripts:

- `/mono-branch` — validate the name, run the script, summarize the new state
- `/mono-push` — run `mono:status` first; warn if pushing would force-push
- `/mono-pr` — the discipline lives here: create a PR **only** for repos whose
  branch actually differs from upstream main; author upstream-facing titles/bodies;
  cross-link companion PRs in both directions; when one PR depends on the other,
  state the dependency and required merge order in both bodies, and note that the
  dependent PR's CI stays red until the dependency merges **and releases** (upstream
  CI installs published packages, not workspace links)
- `/mono-pull` — pull, then summarize what came in; guide conflict resolution
- `/mono-status` — render the dashboard, flag anomalies (drift, unpushed work,
  red CI)
- `/mono-finish` — run the guarded script; if it refuses, explain which check
  failed and what to do; never suggest `--force` unprompted

## 9. README rewrite

Replace the current TODO placeholders with the real workflow:

- what the repo is (one paragraph) and the ephemeral-branch model (the "sources
  only exist on feature branches" surprise, stated up front)
- Setup: `git clone` + `pnpm install` (no submodule/subtree bootstrap needed)
- Daily workflow: the §5 commands with a worked `feat/foo` example, including
  share-with-teammate (`git checkout feat/foo && pnpm install`)
- Dev loop (unchanged): `dev:packages` + `dev:demo`/`dev:dojo`, `.env.local` note
- Upstream PRs: push/pr/pull cycle, dependent-PR CI expectation
- Maintainer notes: branch protection setup, `--single-branch`/`--filter=blob:none`
  clone tips, how to add a third repo via `mono.config.json`

## 10. Verification

No committed test harness (deliberate). The scripts are thin orchestrations of
stock git/`gh`; verification is manual, once, during implementation: a throwaway
scratch clone whose `mono.config.json` points at two local fixture "upstream"
repos, walking the lifecycle end to end (branch → commit → push → reviewer commit
→ pull → push → finish) and inspecting the fixture upstreams. Nothing from this is
committed. Ongoing confidence comes from the agent: CLAUDE.md explains the
underlying mechanics, so Claude can diagnose or hand-verify any operation with raw
git when something looks off.

## 11. Deliverables

| # | Deliverable |
|---|---|
| D1 | `mono.config.json` + `scripts/mono/*` (shared lib, branch, push, pull, pr, status, finish) |
| D2 | `package.json` `mono:*` script entries |
| D3 | `.github/workflows/mono-main-guard.yml` + `scripts/mono/main-guard.mjs` |
| D4 | `CLAUDE.md` rewrite |
| D5 | `.claude/commands/mono-{branch,push,pr,pull,status,finish}.md` |
| D6 | `README.md` rewrite (placeholders removed) |

## 12. Out of scope (v1)

- Fork-based pushing (team pushes directly to upstreams)
- Custom fast replay of commits (documented fallback only; `--onto` expected to
  suffice)
- Parallel checkouts via `git worktree` on the mono repo (plain git already allows
  it; may document later)
- ag-ui Python SDKs and anything outside the pnpm workspace globs (present in the
  vendored tree, ignored by the workspace)
- Automated upstream release coordination for dependent PRs (stated in PR bodies,
  handled by humans)
