import { repos, git, run, gitOk, die, ensureClean, ensureOnFeatureBranch, fetchRepo, remoteBranch, subtreeChanged, joshSplit, cutLine, currentBranch } from "./lib.mjs";

const force = process.argv.includes("--force");
ensureOnFeatureBranch();
ensureClean();
const branch = currentBranch();

// Make the pushed twins ancestry of the mono branch (empty `-s ours` merge —
// the trees are already identical, enforced by joshSplit's self-check).
// Without this, a later `mono:pull` of reviewer commits merges against the
// cut-line instead of the twins, re-merging our own changes into themselves
// (spurious conflicts), and mono:status mistakes the pushed branch for
// unpulled upstream work.
function recordSplit(repo, split) {
  if (gitOk(["merge-base", "--is-ancestor", split, "HEAD"])) return;
  git(["merge", "-s", "ours", "-m", `Record split of '${repo.prefix}/' as ${split.slice(0, 12)}`, split]);
  console.log(`${repo.name}: recorded split marker — share it with 'git push origin ${branch}'.`);
}

for (const repo of repos) {
  fetchRepo(repo);
  const upstreamTip = remoteBranch(repo, branch);
  if (!subtreeChanged(repo, branch) && !upstreamTip) {
    console.log(`${repo.name}: no changes — skipping.`);
    continue;
  }

  process.stdout.write(`${repo.name}: splitting ${repo.prefix}/… `);
  const t0 = Date.now();
  const split = joshSplit(repo, cutLine(repo, branch));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (upstreamTip === split) {
    console.log(`${repo.name}: '${branch}' already up to date upstream.`);
    recordSplit(repo, split);
    continue;
  }
  if (upstreamTip && !gitOk(["merge-base", "--is-ancestor", upstreamTip, split]) && !force) {
    die(`${repo.name}: upstream '${branch}' has commits you don't have — run 'pnpm mono:pull' first (or push with --force to overwrite).`);
  }

  run("git", ["push", ...(force ? ["--force"] : []), repo.name, `${split}:refs/heads/${branch}`]);
  console.log(`${repo.name}: pushed '${branch}'.`);
  recordSplit(repo, split);
}
