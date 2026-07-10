![CopilotKitMono](docs/images/header.png)

# CopilotKitMono

A development workspace that links CopilotKit repositories together via pnpm
workspaces:

- [CopilotKit](https://github.com/CopilotKit/CopilotKit) — the best-in-class SDK for building full-stack agentic applications
- [AG-UI](https://github.com/ag-ui-protocol/ag-ui) — the Agent-User Interaction Protocol
- More to come… (add an entry to `mono.config.json`)

## How it works

`main` contains this scaffold **plus the latest vendored sources**: both
upstream repos live on `main` as git subtrees (full history), kept current by
the scheduled `mono-sync` workflow. Cross-repo dependencies are live-linked
through the pnpm workspace. Feature branches are plain branches off `main` —
instant to create. Work is pushed upstream as native branches and PRs; when
they land, `mono-sync` brings the merged result back into `main` and the
branch is deleted. Vendored paths on `main` change only through the sync bot
(CI-enforced for PRs), and `main` is never force-pushed.

## Setup

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone git@github.com:mme/CopilotKitMono.git   # add --filter=blob:none for a lean lazy clone
cd CopilotKitMono
# REQUIRED if you have git-lfs installed (see Maintainer notes) — disarm it for this repo:
git config filter.lfs.smudge cat; git config filter.lfs.clean cat
git config filter.lfs.process cat; git config filter.lfs.required false
pnpm install
```

This repo carries the upstreams' LFS files as **pointers only** (binary demo
assets aren't needed for development). If git-lfs is installed on your
machine it must be disarmed for this repo (the two lines above) — an
LFS-enabled push would permanently break the repo's sync (details in
Maintainer notes).

`main` carries the full vendored histories, so the first clone downloads a
few hundred MB (the `--filter=blob:none` variant fetches blobs on demand
instead). `pnpm install` on `main` is fine — the committed lockfile and
workspace globs are kept truthful by the `mono-sync` workflow; if an install
dirties the lockfile, your `main` is just stale (`git pull`).

Requirements: git ≥ 2.30, pnpm, the [GitHub CLI](https://cli.github.com)
(`gh auth login`), [josh](https://github.com/josh-project/josh)'s `josh-filter`
(used by `mono:push` — install below), and push access to the upstream repos.

### Installing josh-filter

josh publishes no prebuilt binaries, so install via cargo — **pin the tag**:
everyone pushing from a shared branch must run the same josh version so
splits are byte-identical across machines (that's what makes teammate pushes
fast-forward instead of conflict).

**Linux:**

```bash
# Rust toolchain if you don't have one:  mise use -g rust   (or rustup.rs)
cargo install josh-cli --locked \
  --git https://github.com/josh-project/josh.git --tag r26.06.11 \
  --root ~/.local    # installs josh-filter into ~/.local/bin
```

**macOS:**

```bash
brew install rustup && rustup-init -y    # or: brew install rust
cargo install josh-cli --locked \
  --git https://github.com/josh-project/josh.git --tag r26.06.11 \
  --root ~/.local    # make sure ~/.local/bin is on your PATH
```

If the binary lives elsewhere, point the scripts at it with
`JOSH_FILTER=/path/to/josh-filter`.

## Workflow

```bash
pnpm mono:branch feat/foo   # new branch off current main (instant)
# … edit and commit as usual — in either repo, or across both …
pnpm mono:push              # push each changed repo upstream as branch feat/foo
pnpm mono:pr                # open cross-linked PRs (or /mono-pr in Claude Code)
pnpm mono:pull              # bring in commits reviewers pushed to the PR branches
pnpm mono:pull main         # catch up with the upstream mains
pnpm mono:status            # per-repo changes, push state, PR + CI state
pnpm mono:finish            # after PRs merge: verified cleanup of all branches
```

**Sharing:** `git push origin feat/foo`; a teammate runs
`git checkout feat/foo && pnpm install` and has your exact combined state.

**Joining an existing upstream branch:** `pnpm mono:branch feat/bar --from`.

### Rules of the road

- Commit messages are upstream-facing — reviewers see them verbatim. Prefer
  per-repo commits.
- Don't rebase or amend work already pushed upstream unless you intend a
  force-push.
- A PR that depends on the other repo's PR has red CI until the dependency
  merges **and releases** — say so in both PR bodies.

## Development

Run in two terminals:

```bash
# Terminal 1: build & watch all packages
pnpm dev:packages

# Terminal 2: run the demo app (http://localhost:3000)
pnpm dev:demo
```

Edit files in `CopilotKit/` or `ag-ui/` and the browser hot-reloads.

### Other commands

- `pnpm build:packages` — one-shot build
- `pnpm dev:dojo` — run the ag-ui Dojo demo viewer
- `pnpm nx reset` — clear build cache

## Environment

Create `CopilotKit/examples/v2/react/demo/.env.local`:

```
OPENAI_API_KEY=sk-...
```

## Maintainer notes

- The scheduled `mono-sync` workflow keeps `main`'s vendored dirs current
  with the upstream defaults (and regenerates workspace globs + lockfile).
  Run it on demand with `gh workflow run mono-sync` or locally with
  `pnpm mono:sync && git push origin main`.
- If you protect `main`, the sync workflow's pushes must be allowed to bypass
  (or use a PAT). The `mono-main-guard` workflow rejects any `main`-targeted
  PR touching vendored paths — vendored code only enters `main` via the bot.
- Never force-push `main` — its vendored history is shared ancestry.
- Lean clones: `git clone --filter=blob:none` fetches blobs lazily;
  `--single-branch` also skips other people's feature branches.
- LFS: the upstreams LFS-track binary assets; this repo carries only the
  pointer files and has NO LFS storage — and it must stay that way. **If any
  git-lfs-enabled client ever contacts this repo's LFS API, GitHub permanently
  flips the repo into LFS validation and rejects every future vendored push**
  (learned the hard way; the fix was recreating the repo). Hence the setup
  rule below; the sync workflow is already LFS-blind.
- Adding a linked repo: new entry in `mono.config.json`; the next `mono-sync`
  run vendors it and regenerates the workspace globs.
