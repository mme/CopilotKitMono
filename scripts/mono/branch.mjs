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

// main carries the vendored sources (kept fresh by the mono-sync workflow) —
// start from its latest state. Branching from stale main must be a choice,
// never an accident.
const stale = args.includes("--stale");
if (!stale && !tryGit(["pull", "--ff-only", "origin", "main"])) {
  die("could not fast-forward main from origin (offline? diverged?). Fix that, or re-run with --stale to branch from local main as-is.");
}

for (const repo of repos) fetchRepo(repo);
for (const repo of repos) {
  if (remoteBranch(repo, name) && !from) {
    die(`branch '${name}' already exists on ${repo.name} — use --from to join it.`);
  }
}

git(["checkout", "-b", name]);
if (from) {
  for (const repo of repos) {
    const tip = remoteBranch(repo, name);
    if (!tip) {
      console.log(`${repo.name}: no '${name}' upstream — staying on its main state.`);
      continue;
    }
    console.log(`Joining ${repo.name}/${name}: merging into ${repo.prefix}/…`);
    run("git", ["merge", "-X", `subtree=${repo.prefix}`, "-m", `Merge ${repo.name}/${name} into ${repo.prefix}/`, tip]);
  }
}

console.log("\nInstalling workspace…");
run("pnpm", ["install"]);
const dirty = git(["status", "--porcelain"]);
if (dirty) {
  // Only the lockfile may be auto-committed — anything else would become an
  // unreviewed upstream-facing change.
  const extra = dirty.split("\n").filter((l) => !l.endsWith("pnpm-lock.yaml"));
  if (extra.length) {
    die(`install left unexpected changes (only pnpm-lock.yaml may auto-commit):\n${extra.join("\n")}`);
  }
  git(["add", "pnpm-lock.yaml"]);
  git(["commit", "-m", "Sync lockfile for vendored repos"]);
}

console.log(`\nBranch '${name}' is ready. Dev loop: pnpm dev:packages + pnpm dev:demo`);
