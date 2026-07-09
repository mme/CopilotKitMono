// Brings main's vendored dirs up to date with each upstream's default branch.
// Self-bootstrapping: if a prefix isn't vendored yet, the first run vendors it
// (full history); afterwards it merges only new upstream commits. Merges are
// clean by construction — the prefixes are disjoint and humans never modify
// vendored paths on main (CI-enforced) — so this is safe to run unattended.
// Run by .github/workflows/mono-sync.yml on a schedule; also fine locally.
import { ROOT, repos, git, run, gitOk, ensureClean, ensureOnMain, fetchRepo } from "./lib.mjs";
import { syncWorkspace } from "./sync-workspace.mjs";

// The sync only plumbs history — LFS pointer files are what gets committed,
// so never let a locally-installed git-lfs try to smudge (download) the
// actual binaries; on CI that fails against fork LFS storage.
process.env.GIT_LFS_SKIP_SMUDGE = "1";

ensureOnMain();
ensureClean();

let changed = false;
for (const repo of repos) {
  fetchRepo(repo);
  const tip = git(["rev-parse", `refs/remotes/${repo.name}/${repo.defaultBranch}`]);
  if (!gitOk(["cat-file", "-e", `HEAD:${repo.prefix}`])) {
    console.log(`Vendoring ${repo.prefix}/ from ${repo.name}/${repo.defaultBranch}…`);
    run("git", ["merge", "-s", "ours", "--no-commit", "--allow-unrelated-histories", tip]);
    run("git", ["read-tree", `--prefix=${repo.prefix}/`, "-u", tip]);
    git(["commit", "-m", `Add '${repo.prefix}/' from commit '${tip}'`]);
    changed = true;
  } else if (!gitOk(["merge-base", "--is-ancestor", tip, "HEAD"])) {
    console.log(`Merging ${repo.name}/${repo.defaultBranch} into ${repo.prefix}/…`);
    run("git", ["merge", "-X", `subtree=${repo.prefix}`, "-m", `Merge ${repo.name}/${repo.defaultBranch} into ${repo.prefix}/`, tip]);
    changed = true;
  } else {
    console.log(`${repo.name}: up to date.`);
  }
}

// Keep the root workspace globs and lockfile truthful for the vendored trees.
syncWorkspace();
run("pnpm", ["install", "--lockfile-only"]);
if (git(["status", "--porcelain"])) {
  git(["add", "-A"]);
  git(["commit", "-m", "Sync workspace config and lockfile for vendored repos"]);
  changed = true;
}

console.log(changed ? "mono:sync: main updated — push with 'git push origin main'." : "mono:sync: nothing to do.");
