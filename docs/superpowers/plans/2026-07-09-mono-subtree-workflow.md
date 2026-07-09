# Mono Subtree Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the ephemeral-subtree workflow from
`docs/superpowers/specs/2026-07-09-mono-subtree-workflow-design.md`: `mono:*`
scripts, main-guard CI, CLAUDE.md, `/mono-*` slash commands, README rewrite.

**Architecture:** `main` stays scaffold-only; feature branches vendor CopilotKit
and ag-ui as non-squash git subtrees. Each `mono:*` command is a thin Node script
(~40–90 lines) orchestrating stock git/`gh` across the repos listed in
`mono.config.json`. No state files; everything is derived live (`merge-base`,
tree comparison, `gh --json`).

**Tech Stack:** Node ≥ 18 ESM (`.mjs`, builtins only), git (with `git subtree`),
GitHub CLI (`gh`), GitHub Actions.

## Global Constraints

- Zero new dependencies: node builtins + `git` + `gh` only. Plain JS, no TypeScript.
- No state files, no caches, no commit-message parsing (spec §4). All derivation via `git merge-base`, tree comparison, and `gh --json`.
- Vendoring is always non-squash; upstream branch name always equals the mono branch name.
- Naming: pnpm scripts `mono:<verb>` ↔ slash commands `/mono-<verb>`; verbs exactly: `branch`, `push`, `pull`, `pr`, `status`, `finish`.
- Direct pushes to upstreams; no fork support (spec §12).
- State-changing commands refuse dirty trees; scripts print what they do; errors go through `die()` with actionable messages.
- Commits in this repo: imperative subject, no `Co-Authored-By` lines.
- Do not touch existing `dev:*` / `build:*` scripts, `nx.json`, `pnpm-workspace.yaml`.

## File Structure

```
mono.config.json                        # repo registry (Task 1)
scripts/mono/lib.mjs                    # shared helpers (Task 1)
scripts/mono/branch.mjs                 # Task 2
scripts/mono/push.mjs                   # Task 3
scripts/mono/pull.mjs                   # Task 4
scripts/mono/pr.mjs                     # Task 5
scripts/mono/status.mjs                 # Task 6
scripts/mono/finish.mjs                 # Task 7
scripts/mono/main-guard.mjs             # Task 8
.github/workflows/mono-main-guard.yml   # Task 8
package.json                            # Task 8 (add mono:* entries)
CLAUDE.md                               # Task 9 (recreate — currently deleted)
.claude/commands/mono-*.md              # Task 10 (six files)
README.md                               # Task 11 (rewrite)
```

---

### Task 1: Repo registry + shared library

**Files:**
- Create: `mono.config.json`
- Create: `scripts/mono/lib.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (used by every later task):
  - `repos: Array<{name, prefix, remote, ghRepo, defaultBranch}>`
  - `git(args: string[]): string` — run git in repo root, return trimmed stdout, throw on nonzero
  - `tryGit(args): string|null` — like `git` but null on failure
  - `gitOk(args): boolean` — exit-code test (e.g. `merge-base --is-ancestor`)
  - `run(cmd: string, args: string[]): void` — spawn with `stdio: "inherit"` (visible output), throw on nonzero
  - `die(msg: string): never` — print `mono: <msg>` to stderr, exit 1
  - `currentBranch(): string`
  - `ensureClean(): void`, `ensureOnMain(): void`, `ensureOnFeatureBranch(): void`
  - `fetchRepo(repo): void` — add remote if missing, fetch it
  - `remoteBranch(repo, ref): string|null` — SHA of `refs/remotes/<name>/<ref>` or null
  - `cutLine(repo, branch): string` — spec §4 derivation
  - `subtreeChanged(repo, branch): boolean`

- [ ] **Step 1: Write `mono.config.json`**

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

- [ ] **Step 2: Write `scripts/mono/lib.mjs`**

```js
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const config = JSON.parse(readFileSync(join(ROOT, "mono.config.json"), "utf8"));
export const repos = config.repos;

export function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

export function tryGit(args) {
  try { return git(args); } catch { return null; }
}

export function gitOk(args) {
  try { git(args); return true; } catch { return false; }
}

export function run(cmd, args) {
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
}

export function die(msg) {
  console.error(`\nmono: ${msg}`);
  process.exit(1);
}

export function currentBranch() {
  return git(["rev-parse", "--abbrev-ref", "HEAD"]);
}

export function ensureClean() {
  if (git(["status", "--porcelain"])) {
    die("working tree has uncommitted changes — commit or stash first.");
  }
}

export function ensureOnMain() {
  if (currentBranch() !== "main") {
    die(`this command runs on main (you are on '${currentBranch()}').`);
  }
}

export function ensureOnFeatureBranch() {
  if (currentBranch() === "main") {
    die("this command runs on a feature branch, not main. Start one with: pnpm mono:branch <name>");
  }
}

export function fetchRepo(repo) {
  if (!tryGit(["remote", "get-url", repo.name])) {
    git(["remote", "add", repo.name, repo.remote]);
  }
  run("git", ["fetch", "--quiet", repo.name]);
}

export function remoteBranch(repo, ref) {
  return tryGit(["rev-parse", "--verify", "--quiet", `refs/remotes/${repo.name}/${ref}`]);
}

// Cut-line (spec §4): most recent commit shared with upstream. Non-squash
// vendoring makes real upstream commits ancestors of the branch, so this is
// exact. Prefers the feature branch when it exists upstream, else default.
export function cutLine(repo, branch) {
  const tips = [remoteBranch(repo, branch), remoteBranch(repo, repo.defaultBranch)].filter(Boolean);
  const bases = [...new Set(tips.map((t) => tryGit(["merge-base", "HEAD", t])).filter(Boolean))];
  if (!bases.length) {
    die(`no common history with ${repo.name} — is this a vendored feature branch? (try: git fetch ${repo.name})`);
  }
  return bases.reduce((a, b) => (gitOk(["merge-base", "--is-ancestor", a, b]) ? b : a));
}

export function subtreeChanged(repo, branch) {
  return git(["rev-list", "--count", "--no-merges", `${cutLine(repo, branch)}..HEAD`, "--", repo.prefix]) !== "0";
}
```

- [ ] **Step 3: Syntax-check**

Run: `node --check scripts/mono/lib.mjs && node -e "import('./scripts/mono/lib.mjs').then(m => console.log(m.repos.map(r => r.name).join(',')))"`
Expected: `copilotkit,ag-ui`

- [ ] **Step 4: Commit**

```bash
git add mono.config.json scripts/mono/lib.mjs
git commit -m "Add mono repo registry and shared script library"
```

---

### Task 2: `mono:branch`

**Files:**
- Create: `scripts/mono/branch.mjs`

**Interfaces:**
- Consumes from Task 1: `repos`, `git`, `tryGit`, `run`, `die`, `ensureClean`, `ensureOnMain`, `fetchRepo`, `remoteBranch`.
- Produces: CLI `node scripts/mono/branch.mjs <name> [--from]` (wired to `pnpm mono:branch` in Task 8).

- [ ] **Step 1: Write `scripts/mono/branch.mjs`**

```js
import { repos, git, tryGit, run, die, ensureClean, ensureOnMain, fetchRepo, remoteBranch } from "./lib.mjs";

const args = process.argv.slice(2);
const from = args.includes("--from");
const name = args.find((a) => !a.startsWith("--"));
if (!name) die("usage: pnpm mono:branch <name> [--from]");
try {
  git(["check-ref-format", "--branch", name]);
} catch {
  die(`'${name}' is not a valid branch name.`);
}

ensureOnMain();
ensureClean();
if (tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`])) {
  die(`local branch '${name}' already exists.`);
}

console.log("Fetching upstreams (first time downloads full histories — be patient)…");
for (const repo of repos) fetchRepo(repo);

for (const repo of repos) {
  if (remoteBranch(repo, name) && !from) {
    die(`branch '${name}' already exists on ${repo.name} — use --from to join it.`);
  }
}

git(["checkout", "-b", name]);
for (const repo of repos) {
  const ref = from && remoteBranch(repo, name) ? name : repo.defaultBranch;
  console.log(`\nVendoring ${repo.prefix}/ from ${repo.name}/${ref}…`);
  run("git", ["subtree", "add", `--prefix=${repo.prefix}`, repo.name, ref]);
}

console.log("\nInstalling workspace…");
run("pnpm", ["install"]);
if (git(["status", "--porcelain"])) {
  git(["add", "-A"]);
  git(["commit", "-m", "Update lockfile for vendored workspace"]);
}

console.log(`\nBranch '${name}' is ready. Dev loop: pnpm dev:packages + pnpm dev:demo`);
```

- [ ] **Step 2: Syntax-check**

Run: `node --check scripts/mono/branch.mjs`
Expected: no output, exit 0. (Behavioral check happens in Task 12 against fixtures; do not run against the real upstreams here.)

- [ ] **Step 3: Commit**

```bash
git add scripts/mono/branch.mjs
git commit -m "Add mono:branch — vendor upstreams into a new feature branch"
```

---

### Task 3: `mono:push`

**Files:**
- Create: `scripts/mono/push.mjs`

**Interfaces:**
- Consumes from Task 1: `repos`, `git`, `run`, `gitOk`, `die`, `ensureClean`, `ensureOnFeatureBranch`, `fetchRepo`, `remoteBranch`, `subtreeChanged`, `currentBranch`.
- Produces: CLI `node scripts/mono/push.mjs [--force]`.

- [ ] **Step 1: Write `scripts/mono/push.mjs`**

```js
import { repos, git, run, gitOk, die, ensureClean, ensureOnFeatureBranch, fetchRepo, remoteBranch, subtreeChanged, currentBranch } from "./lib.mjs";

const force = process.argv.includes("--force");
ensureOnFeatureBranch();
ensureClean();
const branch = currentBranch();

for (const repo of repos) {
  fetchRepo(repo);
  const upstreamTip = remoteBranch(repo, branch);
  if (!subtreeChanged(repo, branch) && !upstreamTip) {
    console.log(`${repo.name}: no changes — skipping.`);
    continue;
  }

  process.stdout.write(`${repo.name}: splitting ${repo.prefix}/… `);
  const t0 = Date.now();
  const split = git(["subtree", "split", `--prefix=${repo.prefix}`]);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (upstreamTip === split) {
    console.log(`${repo.name}: '${branch}' already up to date upstream.`);
    continue;
  }
  if (upstreamTip && !gitOk(["merge-base", "--is-ancestor", upstreamTip, split]) && !force) {
    die(`${repo.name}: upstream '${branch}' has commits you don't have — run 'pnpm mono:pull' first (or push with --force to overwrite).`);
  }

  run("git", ["push", ...(force ? ["--force"] : []), repo.name, `${split}:refs/heads/${branch}`]);
  console.log(`${repo.name}: pushed '${branch}'.`);
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check scripts/mono/push.mjs`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/mono/push.mjs
git commit -m "Add mono:push — split subtrees and push upstream"
```

---

### Task 4: `mono:pull`

**Files:**
- Create: `scripts/mono/pull.mjs`

**Interfaces:**
- Consumes from Task 1: `repos`, `run`, `gitOk`, `ensureClean`, `ensureOnFeatureBranch`, `fetchRepo`, `remoteBranch`, `currentBranch`.
- Produces: CLI `node scripts/mono/pull.mjs [main]`.

- [ ] **Step 1: Write `scripts/mono/pull.mjs`**

```js
import { repos, run, gitOk, ensureClean, ensureOnFeatureBranch, fetchRepo, remoteBranch, currentBranch } from "./lib.mjs";

const toMain = process.argv[2] === "main";
ensureOnFeatureBranch();
ensureClean();
const branch = currentBranch();

for (const repo of repos) {
  fetchRepo(repo);
  const ref = toMain ? repo.defaultBranch : branch;
  const tip = remoteBranch(repo, ref);
  if (!tip) {
    console.log(`${repo.name}: no '${ref}' upstream — skipping.`);
    continue;
  }
  if (gitOk(["merge-base", "--is-ancestor", tip, "HEAD"])) {
    console.log(`${repo.name}: already up to date with ${ref}.`);
    continue;
  }
  console.log(`\nMerging ${repo.name}/${ref} into ${repo.prefix}/…`);
  run("git", ["subtree", "pull", `--prefix=${repo.prefix}`, repo.name, ref]);
}

console.log("\nDone. If pnpm-lock or deps changed upstream, run: pnpm install");
```

Note for the implementer: on merge conflicts `git subtree pull` stops mid-merge
exactly like `git merge`; `run()` throws, the script exits nonzero, and the user
resolves + commits in the working tree. That is the intended UX — do not add
conflict handling.

- [ ] **Step 2: Syntax-check**

Run: `node --check scripts/mono/pull.mjs`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/mono/pull.mjs
git commit -m "Add mono:pull — merge upstream branches or main into subtrees"
```

---

### Task 5: `mono:pr`

**Files:**
- Create: `scripts/mono/pr.mjs`

**Interfaces:**
- Consumes from Task 1: `repos`, `gitOk`, `die`, `ensureOnFeatureBranch`, `fetchRepo`, `remoteBranch`, `currentBranch`.
- Produces: CLI `node scripts/mono/pr.mjs [--repo <name>] [--title <t>] [--body-file <f>] [--link]`.
  - bare / `--repo`: create PRs (skip unpushed repos, repos with no diff vs default branch, repos with an existing PR)
  - `--link`: append `Companion PR: <url>` to each PR body, both directions

- [ ] **Step 1: Write `scripts/mono/pr.mjs`**

```js
import { execFileSync } from "node:child_process";
import { repos, gitOk, die, ensureOnFeatureBranch, fetchRepo, remoteBranch, currentBranch } from "./lib.mjs";

function gh(args) {
  try {
    return execFileSync("gh", args, { encoding: "utf8" }).trim();
  } catch (e) {
    die(`gh failed (${args.slice(0, 2).join(" ")}): ${e.stderr?.toString().trim() || e.message}. Is gh installed and authenticated?`);
  }
}

function findPr(repo, branch) {
  const out = gh(["pr", "list", "--repo", repo.ghRepo, "--head", branch, "--state", "all",
    "--json", "number,url,state,title"]);
  return (out ? JSON.parse(out) : [])[0] ?? null;
}

ensureOnFeatureBranch();
const branch = currentBranch();
const args = process.argv.slice(2);
const opt = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

if (args.includes("--link")) {
  const withPr = repos.map((r) => ({ repo: r, pr: findPr(r, branch) })).filter((x) => x.pr);
  if (withPr.length < 2) die("--link needs PRs to exist in at least two repos.");
  for (const { repo, pr } of withPr) {
    const others = withPr.filter((x) => x.pr.url !== pr.url).map((x) => x.pr.url).join(", ");
    const body = gh(["pr", "view", String(pr.number), "--repo", repo.ghRepo, "--json", "body", "--jq", ".body"]);
    if (body.includes(others)) {
      console.log(`${repo.name}: already linked.`);
    } else {
      gh(["pr", "edit", String(pr.number), "--repo", repo.ghRepo, "--body", `${body}\n\nCompanion PR: ${others}`]);
      console.log(`${repo.name}: linked ${pr.url} -> ${others}`);
    }
  }
  process.exit(0);
}

const only = opt("--repo");
if (only && !repos.some((r) => r.name === only)) die(`unknown repo '${only}' (known: ${repos.map((r) => r.name).join(", ")}).`);

for (const repo of repos) {
  if (only && repo.name !== only) continue;
  fetchRepo(repo);
  const tip = remoteBranch(repo, branch);
  if (!tip) {
    console.log(`${repo.name}: branch not pushed — skipping (run 'pnpm mono:push' first).`);
    continue;
  }
  if (gitOk(["merge-base", "--is-ancestor", tip, remoteBranch(repo, repo.defaultBranch)])) {
    console.log(`${repo.name}: no diff against ${repo.defaultBranch} — no PR needed.`);
    continue;
  }
  const existing = findPr(repo, branch);
  if (existing) {
    console.log(`${repo.name}: PR already exists: ${existing.url}`);
    continue;
  }
  const bodyFile = opt("--body-file");
  const url = gh(["pr", "create", "--repo", repo.ghRepo, "--head", branch, "--base", repo.defaultBranch,
    "--title", opt("--title") ?? branch,
    ...(bodyFile ? ["--body-file", bodyFile] : ["--body", ""])]);
  console.log(`${repo.name}: created ${url}`);
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check scripts/mono/pr.mjs`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/mono/pr.mjs
git commit -m "Add mono:pr — create and cross-link upstream PRs"
```

---

### Task 6: `mono:status`

**Files:**
- Create: `scripts/mono/status.mjs`

**Interfaces:**
- Consumes from Task 1: `repos`, `git`, `tryGit`, `gitOk`, `ensureOnFeatureBranch`, `fetchRepo`, `remoteBranch`, `cutLine`, `currentBranch`.
- Produces: CLI `node scripts/mono/status.mjs` (read-only, safe anywhere on a feature branch). "Pushed" is judged by tree equality (`HEAD:<prefix>` vs upstream branch tree) — content truth, no split needed.

- [ ] **Step 1: Write `scripts/mono/status.mjs`**

```js
import { execFileSync } from "node:child_process";
import { repos, git, tryGit, gitOk, ensureOnFeatureBranch, fetchRepo, remoteBranch, cutLine, currentBranch } from "./lib.mjs";

ensureOnFeatureBranch();
const branch = currentBranch();

tryGit(["fetch", "--quiet", "origin"]);
const originTip = tryGit(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
const head = git(["rev-parse", "HEAD"]);
console.log(`branch: ${branch}`);
console.log(`mono origin: ${originTip === head ? "pushed" : originTip ? "behind local — push to share" : "not pushed"}`);

for (const repo of repos) {
  fetchRepo(repo);
  const cut = cutLine(repo, branch);
  const ours = git(["rev-list", "--count", "--no-merges", `${cut}..HEAD`, "--", repo.prefix]);
  const tip = remoteBranch(repo, branch);
  const localTree = git(["rev-parse", `HEAD:${repo.prefix}`]);
  const pushed = tip
    ? tryGit(["rev-parse", `${tip}^{tree}`]) === localTree ? "pushed" : "out of date — run 'pnpm mono:push'"
    : ours !== "0" ? "not pushed" : "n/a (no changes)";

  let pr = "no PR";
  try {
    const out = execFileSync("gh", ["pr", "list", "--repo", repo.ghRepo, "--head", branch, "--state", "all",
      "--json", "number,state,url,statusCheckRollup"], { encoding: "utf8" });
    const p = JSON.parse(out)[0];
    if (p) {
      const checks = (p.statusCheckRollup ?? []).map((c) => c.conclusion ?? c.state ?? "");
      const ci = !checks.length ? "no checks"
        : checks.every((c) => /SUCCESS|NEUTRAL|SKIPPED/.test(c)) ? "CI green" : "CI failing or pending";
      pr = `PR #${p.number} ${p.state} (${ci}) ${p.url}`;
    }
  } catch {
    pr = "PR state unavailable (gh missing/unauthenticated)";
  }

  console.log(`\n${repo.name} (${repo.prefix}/)`);
  console.log(`  our commits since cut-line ${cut.slice(0, 7)}: ${ours}`);
  console.log(`  upstream '${branch}': ${pushed}`);
  console.log(`  ${pr}`);
  if (tip && !gitOk(["merge-base", "--is-ancestor", tip, "HEAD"])) {
    console.log(`  note: upstream has commits not in this branch — run 'pnpm mono:pull'.`);
  }
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check scripts/mono/status.mjs`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/mono/status.mjs
git commit -m "Add mono:status — cross-repo dashboard"
```

---

### Task 7: `mono:finish`

**Files:**
- Create: `scripts/mono/finish.mjs`

**Interfaces:**
- Consumes from Task 1: `repos`, `git`, `tryGit`, `die`, `ensureClean`, `ensureOnFeatureBranch`, `fetchRepo`, `remoteBranch`, `currentBranch`.
- Produces: CLI `node scripts/mono/finish.mjs [--force]`. Refuses unless: clean tree, branch fully pushed to origin, and (unless `--force`) every upstream-pushed repo has a MERGED/CLOSED PR. Interactive confirmation before deleting; per-repo prompt for upstream branch deletion. `--force` skips PR checks only — never the clean/pushed checks.

- [ ] **Step 1: Write `scripts/mono/finish.mjs`**

```js
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { repos, git, tryGit, die, ensureClean, ensureOnFeatureBranch, fetchRepo, remoteBranch, currentBranch } from "./lib.mjs";

const force = process.argv.includes("--force");
ensureOnFeatureBranch();
ensureClean();
const branch = currentBranch();

tryGit(["fetch", "--quiet", "origin"]);
const originTip = tryGit(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
if (originTip !== git(["rev-parse", "HEAD"])) {
  die(`'${branch}' is not fully pushed to origin — 'git push origin ${branch}' first (finish never deletes unshared work).`);
}

const pushedRepos = [];
for (const repo of repos) {
  fetchRepo(repo);
  if (remoteBranch(repo, branch)) pushedRepos.push(repo);
}

if (!force) {
  for (const repo of pushedRepos) {
    let pr;
    try {
      pr = JSON.parse(execFileSync("gh", ["pr", "list", "--repo", repo.ghRepo, "--head", branch, "--state", "all",
        "--json", "number,state,url"], { encoding: "utf8" }))[0] ?? null;
    } catch {
      die(`cannot check PR state for ${repo.name} — is gh installed and authenticated? (--force to skip PR checks)`);
    }
    if (!pr) die(`${repo.name}: '${branch}' is pushed upstream but has no PR — finishing would strand it. (--force to override)`);
    if (pr.state !== "MERGED" && pr.state !== "CLOSED") {
      die(`${repo.name}: PR #${pr.number} is still ${pr.state}: ${pr.url}`);
    }
  }
}

console.log("\nThis will delete:");
console.log(`  local branch   ${branch}`);
console.log(`  origin/${branch}`);
for (const r of pushedRepos) console.log(`  ${r.name}/${branch}  (upstream — asked per repo)`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
if ((await rl.question("\nProceed? [y/N] ")).trim().toLowerCase() !== "y") {
  rl.close();
  die("aborted — nothing deleted.");
}

git(["checkout", "main"]);
git(["branch", "-D", branch]);
git(["push", "origin", "--delete", branch]);
console.log(`Deleted local and origin '${branch}'.`);

for (const repo of pushedRepos) {
  if (!remoteBranch(repo, branch)) continue;
  if ((await rl.question(`Delete ${repo.name}/${branch} upstream too? [y/N] `)).trim().toLowerCase() === "y") {
    git(["push", repo.name, "--delete", branch]);
    console.log(`Deleted ${repo.name}/${branch}.`);
  }
}
rl.close();
console.log("\nDone. Back on scaffold main.");
```

- [ ] **Step 2: Syntax-check**

Run: `node --check scripts/mono/finish.mjs`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/mono/finish.mjs
git commit -m "Add mono:finish — guarded branch cleanup"
```

---

### Task 8: pnpm wiring + main-guard (script, workflow)

**Files:**
- Modify: `package.json` (scripts block only)
- Create: `scripts/mono/main-guard.mjs`
- Create: `.github/workflows/mono-main-guard.yml`

**Interfaces:**
- Consumes from Task 1: `repos`, `git`.
- Produces: `pnpm mono:<verb>` for all six verbs; CI job failing any `main`-targeted PR whose diff touches a vendored prefix.

- [ ] **Step 1: Add scripts to `package.json`**

Add inside the existing `"scripts"` object (keep existing entries untouched):

```json
"mono:branch": "node scripts/mono/branch.mjs",
"mono:push": "node scripts/mono/push.mjs",
"mono:pull": "node scripts/mono/pull.mjs",
"mono:pr": "node scripts/mono/pr.mjs",
"mono:status": "node scripts/mono/status.mjs",
"mono:finish": "node scripts/mono/finish.mjs"
```

(pnpm forwards trailing args/flags to scripts, so `pnpm mono:branch feat/x --from` works as-is.)

- [ ] **Step 2: Write `scripts/mono/main-guard.mjs`**

```js
import { repos, git } from "./lib.mjs";

const base = process.argv[2] ?? "origin/main";
const changed = git(["diff", "--name-only", `${base}...HEAD`]).split("\n").filter(Boolean);
const bad = changed.filter((f) => repos.some((r) => f === r.prefix || f.startsWith(`${r.prefix}/`)));

if (bad.length) {
  console.error("Vendored sources must never target main. Offending paths:");
  for (const f of bad) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`main-guard: OK (${changed.length} changed files, none vendored)`);
```

- [ ] **Step 3: Write `.github/workflows/mono-main-guard.yml`**

```yaml
name: mono-main-guard
on:
  pull_request:
    branches: [main]
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node scripts/mono/main-guard.mjs origin/${{ github.base_ref }}
```

- [ ] **Step 4: Verify guard logic locally**

```bash
node --check scripts/mono/main-guard.mjs
node scripts/mono/main-guard.mjs HEAD   # empty diff against self
```

Expected: `main-guard: OK (0 changed files, none vendored)`

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/mono/main-guard.mjs .github/workflows/mono-main-guard.yml
git commit -m "Wire mono:* pnpm scripts and add main-guard CI"
```

---

### Task 9: CLAUDE.md rewrite

**Files:**
- Create: `CLAUDE.md` (the old file is already deleted from the working tree; this commit records the replacement)

**Interfaces:**
- Consumes: command names from Tasks 2–8 (must match exactly).
- Produces: the document agents load each session — includes an "under the hood" section so the agent can fall back to raw git/`gh` beyond the scripts.

- [ ] **Step 1: Write `CLAUDE.md`**

````markdown
# CLAUDE.md

## What this repo is

CopilotKitMono is a meta-workspace for developing
[CopilotKit](https://github.com/CopilotKit/CopilotKit) and
[ag-ui](https://github.com/ag-ui-protocol/ag-ui) together, live-linked through a
pnpm workspace. The model in three sentences:

1. **`main` is scaffold only** — scripts, workspace config, docs. It never
   contains `CopilotKit/` or `ag-ui/` sources.
2. **Feature branches vendor both repos** as git subtrees (full history, never
   `--squash`) at branch creation. All development happens on feature branches.
3. **Branches are ephemeral.** Work ships as native upstream branches/PRs; after
   the PRs land, the branch is deleted. Vendored code never merges to `main`
   (CI-enforced).

On `main` the source dirs don't exist — that's by design, not breakage.

## Commands

Prefer these over raw `git subtree` (they add the safety checks):

| Command | What it does |
|---|---|
| `pnpm mono:branch <name> [--from]` | new feature branch; vendors both repos (`--from`: join existing upstream branch `<name>`) |
| `pnpm mono:push [--force]` | translate each changed subtree into upstream-native commits, push as branch `<name>` |
| `pnpm mono:pull` | merge commits others pushed to our upstream PR branches |
| `pnpm mono:pull main` | merge upstream `main` into the vendored dirs |
| `pnpm mono:pr [--repo <name>] [--title <t>] [--body-file <f>] [--link]` | open / cross-link upstream PRs |
| `pnpm mono:status` | dashboard: per-repo changes, push state, PR + CI state |
| `pnpm mono:finish [--force]` | after PRs merge/close: verified deletion of local, origin, and upstream branches |

Dev loop: `pnpm dev:packages` (terminal 1) + `pnpm dev:demo` or `pnpm dev:dojo`
(terminal 2). The demo needs `OPENAI_API_KEY` in
`CopilotKit/examples/v2/react/demo/.env.local`.

## How it works under the hood

Know this so you can answer questions and handle cases the scripts don't cover
using raw `git`/`gh`. The repo registry is `mono.config.json` (remote names
`copilotkit`, `ag-ui`).

- `mono:branch` = `git checkout -b` + per repo `git subtree add --prefix=<dir>
  <remote> <ref>` (never `--squash`). Real upstream history becomes ancestry of
  the branch, so `git log` / `git blame` inside vendored dirs are truthful.
- The **cut-line** (where upstream ends and our work begins) is stored nowhere;
  it is `git merge-base HEAD <remote>/<branch-or-default>`. Our commits for one
  repo: `git log <cut-line>..HEAD -- <prefix>/`.
- `mono:push` = `git subtree split --prefix=<dir>` (translates our commits into
  upstream-rooted twins — same messages/authors, different SHAs) then `git push
  <remote> <split-sha>:refs/heads/<branch>`. Split is deterministic; re-pushing
  fast-forwards.
- `mono:pull` = `git subtree pull --prefix=<dir> <remote> <ref>` (never
  `--squash`) — a real merge of real upstream commits; conflicts are normal
  merge conflicts.
- Upstream PR/issue work: `gh --repo CopilotKit/CopilotKit …`,
  `gh --repo ag-ui-protocol/ag-ui …`.

## Rules

- **Commit messages are upstream-facing.** They become upstream commits
  verbatim, read by reviewers with zero mono-repo context. A commit touching
  both repos becomes two upstream commits sharing one message — if the message
  can't stand alone in both repos, split the commit. Prefer per-repo commits.
- **Append-only after `mono:push`.** Rebasing/amending pushed commits forces a
  force-push upstream — warn first, never do it casually.
- **Never merge a vendored branch into `main`.** Scaffold changes travel on
  plain branches off `main` (no vendored dirs) via normal PRs to this repo.
- **PR discipline**: open a PR only for a repo whose branch actually differs
  from its upstream main; cross-link companion PRs in both bodies
  (`pnpm mono:pr --link`); when one PR depends on the other, state the
  dependency and merge order in both bodies and note the dependent PR's CI
  stays red until the dependency merges **and releases** (upstream CI installs
  published packages, not workspace links).
- Do not add `Co-Authored-By` lines to commits.

## Key paths (exist on feature branches only)

- CopilotKit v1: `CopilotKit/packages/v1/*` (`@copilotkit/*`) · v2:
  `CopilotKit/packages/v2/*` (`@copilotkitnext/*`)
- ag-ui TS SDK: `ag-ui/sdks/typescript/packages/*` · integrations:
  `ag-ui/integrations/*/typescript` · middlewares: `ag-ui/middlewares/*`
- Demo app: `CopilotKit/examples/v2/react/demo/`
````

- [ ] **Step 2: Commit (records old CLAUDE.md deletion + new content together)**

```bash
git add CLAUDE.md
git commit -m "Rewrite CLAUDE.md for the ephemeral subtree workflow"
```

---

### Task 10: Slash commands

**Files:**
- Create: `.claude/commands/mono-branch.md`
- Create: `.claude/commands/mono-push.md`
- Create: `.claude/commands/mono-pr.md`
- Create: `.claude/commands/mono-pull.md`
- Create: `.claude/commands/mono-status.md`
- Create: `.claude/commands/mono-finish.md`

**Interfaces:**
- Consumes: `pnpm mono:*` commands (names must match Tasks 2–8) and CLAUDE.md rules (Task 9).
- Produces: `/mono-*` commands available in Claude Code sessions in this repo.

- [ ] **Step 1: Write `.claude/commands/mono-branch.md`**

```markdown
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
```

- [ ] **Step 2: Write `.claude/commands/mono-push.md`**

```markdown
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
4. Report per repo: branch pushed or skipped, and why.

$ARGUMENTS
```

- [ ] **Step 3: Write `.claude/commands/mono-pr.md`**

```markdown
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
```

- [ ] **Step 4: Write `.claude/commands/mono-pull.md`**

```markdown
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
```

- [ ] **Step 5: Write `.claude/commands/mono-status.md`**

```markdown
---
description: Show the cross-repo dashboard for the current mono branch
---

Run `pnpm mono:status` and present the result compactly. Flag anomalies with a
suggested action:

- commits not pushed upstream → suggest /mono-push
- upstream has commits we lack → suggest /mono-pull
- failing CI on a PR → offer to investigate: `gh --repo <ghRepo> pr checks <number>`
- pushed branch but no PR → suggest /mono-pr
- mono branch not pushed to origin → remind that teammates can't see the work

$ARGUMENTS
```

- [ ] **Step 6: Write `.claude/commands/mono-finish.md`**

```markdown
---
description: Clean up a finished mono branch (verified, guarded)
---

Finish the current mono branch.

1. Run `pnpm mono:status` and confirm every pushed repo's PR is MERGED or
   CLOSED. If any PR is still open, stop and tell the user — do not finish.
2. Run `pnpm mono:finish`. It re-verifies and asks for confirmation before
   deleting anything; relay its prompts to the user faithfully.
3. If it refuses, explain exactly which check failed and the next step.
   Never suggest `--force` unless the user explicitly wants to abandon work.

$ARGUMENTS
```

- [ ] **Step 7: Commit**

```bash
git add .claude/commands
git commit -m "Add /mono-* slash commands"
```

---

### Task 11: README rewrite

**Files:**
- Modify: `README.md` (full rewrite; keep the header image line)

**Interfaces:**
- Consumes: command set (Tasks 2–8). All TODO placeholders must be gone.

- [ ] **Step 1: Rewrite `README.md`**

````markdown
![CopilotKitMono](docs/images/header.png)

# CopilotKitMono - Your All-in-One CopilotKit Experience

A development workspace that links CopilotKit repositories together via pnpm
workspaces:

- [CopilotKit](https://github.com/CopilotKit/CopilotKit) — the best-in-class SDK for building full-stack agentic applications
- [AG-UI](https://github.com/ag-ui-protocol/ag-ui) — the Agent-User Interaction Protocol
- More to come… (add an entry to `mono.config.json`)

## How it works

`main` contains only this scaffold — **the sources live on feature branches**.
Starting a feature vendors both upstream repos into the branch as git subtrees
(full history), and cross-repo dependencies are live-linked through the pnpm
workspace. Work is pushed upstream as native branches and PRs; when they land,
the branch is deleted. Vendored sources never merge to `main` (CI-enforced).

So don't be surprised: on `main`, `CopilotKit/` and `ag-ui/` don't exist.

## Setup

```bash
git clone git@github.com:mme/CopilotKitMono.git
cd CopilotKitMono
pnpm install
```

Requirements: git (with `git subtree`), pnpm, the [GitHub CLI](https://cli.github.com)
(`gh auth login`), and push access to the upstream repos.

## Workflow

```bash
pnpm mono:branch feat/foo   # new branch; vendors CopilotKit/ + ag-ui/
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

- Protect `main` (require PRs). The `mono-main-guard` workflow rejects any
  `main`-targeted PR touching vendored paths.
- Lean clones: `git clone --single-branch` (or `--filter=blob:none`) skips
  other people's vendored feature branches.
- Adding a linked repo: new entry in `mono.config.json` + package globs in
  `pnpm-workspace.yaml`.
````

- [ ] **Step 2: Check no placeholders remain**

Run: `grep -n "TODO" README.md`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Rewrite README for the ephemeral subtree workflow"
```

---

### Task 12: Manual end-to-end verification (nothing committed)

**Files:** none (throwaway scratch dir only).

Walks the whole lifecycle against local fixture upstreams. `gh`-dependent paths
(`mono:pr`, PR checks in `mono:finish`) cannot run against local fixtures — for
those, verify the skip/guard messages fire, and verify `mono:finish --force`.

- [ ] **Step 1: Build fixtures in the scratchpad**

```bash
S=$(mktemp -d)   # or a dir inside the session scratchpad
cd "$S"
git init --bare -b main ck.git
git init --bare -b main agu.git
git init --bare -b main origin.git
git clone ck.git seed-ck  && cd seed-ck  && mkdir -p packages/core && echo "export const a = 1" > packages/core/a.ts \
  && git add -A && git commit -m "ck initial" && git push && cd ..
git clone agu.git seed-agu && cd seed-agu && mkdir -p sdks/ts && echo "export const b = 1" > sdks/ts/b.ts \
  && git add -A && git commit -m "agu initial" && git push && cd ..
```

- [ ] **Step 2: Scratch clone of the real repo, pointed at fixtures**

```bash
git clone /home/mme/Projects/CopilotKitMono "$S/mono" && cd "$S/mono"
git remote set-url origin "$S/origin.git" && git push -u origin main
# point the registry at the fixtures (commit on the scratch clone's main)
node -e '
const fs = require("fs");
const c = JSON.parse(fs.readFileSync("mono.config.json", "utf8"));
c.repos[0].remote = process.env.S + "/ck.git";
c.repos[1].remote = process.env.S + "/agu.git";
fs.writeFileSync("mono.config.json", JSON.stringify(c, null, 2));
' && git commit -am "Point registry at fixtures (scratch only)" && git push
```

- [ ] **Step 3: branch → commit → push**

```bash
node scripts/mono/branch.mjs feat/t          # pnpm install may churn; that's fine
[ -d CopilotKit ] && [ -d ag-ui ] && echo VENDORED-OK
echo "export const a = 2" > CopilotKit/packages/core/a.ts
git commit -am "Change core export"
node scripts/mono/push.mjs
git -C "$S/ck.git" log --oneline feat/t      # expect: "Change core export" + "ck initial"
git -C "$S/ck.git" show feat/t --stat        # expect path packages/core/a.ts (no CopilotKit/ prefix)
node scripts/mono/push.mjs                   # expect: ck "already up to date", agu "no changes"
```

- [ ] **Step 4: mixed commit → push touches both**

```bash
echo x >> CopilotKit/packages/core/a.ts && echo y >> ag-ui/sdks/ts/b.ts
git commit -am "Coordinated change across repos"
node scripts/mono/push.mjs
git -C "$S/agu.git" log --oneline feat/t     # expect the mixed commit, agu-side only
```

- [ ] **Step 5: reviewer round-trip**

```bash
cd "$S/seed-ck" && git fetch origin feat/t && git checkout feat/t \
  && echo r >> packages/core/a.ts && git commit -am "Review fixup" && git push origin feat/t && cd "$S/mono"
node scripts/mono/pull.mjs                   # merges the fixup into CopilotKit/
grep -q r CopilotKit/packages/core/a.ts && echo PULL-OK
node scripts/mono/push.mjs                   # expect fast-forward, NO --force needed
```

- [ ] **Step 6: upstream main movement + guards**

```bash
cd "$S/seed-ck" && git checkout main && echo m >> packages/core/a.ts \
  && git commit -am "Mainline change" && git push origin main && cd "$S/mono"
node scripts/mono/pull.mjs main              # merge conflict expected (same file) — resolve, commit, rerun if needed
echo dirty > somefile && node scripts/mono/push.mjs; rm somefile   # expect refusal: dirty tree
node scripts/mono/status.mjs                 # PR lines read "unavailable/no PR" — fine without gh fixtures
node scripts/mono/main-guard.mjs main        # on feat/t vs main: expect FAILURE (vendored paths present)
```

- [ ] **Step 7: finish (--force path, since no real PRs exist)**

```bash
git push origin feat/t
node scripts/mono/finish.mjs                 # expect refusal (no PR / gh state)
node scripts/mono/finish.mjs --force         # confirm 'y'; expect: back on main, branches deleted
git branch --list 'feat/t'                   # expect empty
ls CopilotKit 2>&1                           # expect: No such file or directory
```

- [ ] **Step 8: clean up scratch, report**

```bash
rm -rf "$S"
```

Report results per step; any deviation is a bug to fix before declaring done.

---

## Self-review notes (already applied)

- Spec coverage: §4 derivation → `cutLine`/tree-compare (T1, T6); §5 commands → T2–T7; §6 split + duration print → T3; §7 guards → lib guards + T8; §8 → T9/T10; §9 → T11; §10 manual verification → T12.
- Consistency: every script imports only names exported by `lib.mjs` (T1 Interfaces block is the canonical list); command names identical across package.json, CLAUDE.md, slash commands, README.
