import { repos, git, tryGit, run, gitOk, die, ensureClean, ensureOnFeatureBranch, fetchRepo, remoteBranch, subtreeChanged, joshSplit, cutLine, currentBranch } from "./lib.mjs";

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

  // --force-with-lease pins any overwrite to the tip we just fetched, so a
  // reviewer commit landing between fetch and push is never clobbered.
  run("git", ["push", ...(force && upstreamTip ? [`--force-with-lease=refs/heads/${branch}:${upstreamTip}`] : []), repo.name, `${split}:refs/heads/${branch}`]);
  console.log(`${repo.name}: pushed '${branch}'.`);
  recordSplit(repo, split);
}

// Share the split markers: if the mono branch already lives on origin, push
// it now — a teammate who picks up the branch without the markers gets
// spurious conflicts on their next mono:pull.
tryGit(["fetch", "--quiet", "origin"]);
const originTip = tryGit(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
if (originTip && originTip !== git(["rev-parse", "HEAD"])) {
  if (tryGit(["push", "origin", branch]) !== null) {
    console.log(`origin: pushed '${branch}' (split markers shared).`);
  } else {
    console.log(`origin: could not push '${branch}' — share the split markers with 'git push origin ${branch}' (pull first if it diverged).`);
  }
}
