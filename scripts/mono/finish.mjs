import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { repos, git, tryGit, die, ensureClean, ensureOnFeatureBranch, fetchRepo, remoteBranch, subtreeChanged, currentBranch } from "./lib.mjs";

const force = process.argv.includes("--force");
const yes = process.argv.includes("--yes");
ensureOnFeatureBranch();
ensureClean();
const branch = currentBranch();

if (tryGit(["fetch", "--quiet", "origin"]) === null) {
  die("could not fetch origin — check connectivity before finishing (the pushed-to-origin check needs fresh refs).");
}
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
  for (const repo of repos) {
    const pushed = pushedRepos.includes(repo);
    // A repo with subtree commits but no upstream branch AND no PR has work
    // that shipped nowhere — deleting the branch would be the only copy dying.
    if (!pushed && !subtreeChanged(repo, branch)) continue;
    let pr;
    try {
      pr = JSON.parse(execFileSync("gh", ["pr", "list", "--repo", repo.ghRepo, "--head", branch, "--state", "all",
        "--json", "number,state,url"], { encoding: "utf8" }))[0] ?? null;
    } catch {
      die(`cannot check PR state for ${repo.name} — is gh installed and authenticated? (--force to skip PR checks)`);
    }
    if (!pr) {
      die(pushed
        ? `${repo.name}: '${branch}' is pushed upstream but has no PR — finishing would strand it. (--force to override)`
        : `${repo.name}: has subtree commits that were never pushed upstream (no branch, no PR) — 'pnpm mono:push' first, or --force to abandon them.`);
    }
    if (pr.state !== "MERGED" && pr.state !== "CLOSED") {
      die(`${repo.name}: PR #${pr.number} is still ${pr.state}: ${pr.url}`);
    }
  }
}

// Scaffold-only commits (outside every vendored prefix) ship nowhere — say so.
const scaffoldCount = tryGit(["rev-list", "--count", "refs/remotes/origin/main..HEAD", "--", ".", ...repos.map((r) => `:(exclude)${r.prefix}`)]);
if (scaffoldCount && scaffoldCount !== "0") {
  console.log(`\nnote: ${scaffoldCount} commit(s) touch scaffold files outside the vendored dirs — those changes ship nowhere and die with the branch.`);
}

console.log("\nThis will delete:");
console.log(`  local branch   ${branch}`);
console.log(`  origin/${branch}`);
for (const r of pushedRepos) console.log(`  ${r.name}/${branch}  (upstream — asked per repo)`);

if (!yes && !process.stdin.isTTY) {
  die("confirmation needs a terminal — run 'pnpm mono:finish' interactively, or re-run with --yes if you have already confirmed the deletions above.");
}

const rl = yes ? null : createInterface({ input: process.stdin, output: process.stdout });
async function confirm(prompt) {
  if (yes) { console.log(`${prompt} y (--yes)`); return true; }
  return (await rl.question(prompt)).trim().toLowerCase() === "y";
}

if (!(await confirm("\nProceed? [y/N] "))) {
  rl?.close();
  die("aborted — nothing deleted.");
}

git(["checkout", "main"]);
git(["branch", "-D", branch]);
git(["push", "origin", "--delete", branch]);
console.log(`Deleted local and origin '${branch}'.`);

for (const repo of pushedRepos) {
  if (!remoteBranch(repo, branch)) continue;
  if (await confirm(`Delete ${repo.name}/${branch} upstream too? [y/N] `)) {
    if (tryGit(["push", repo.name, "--delete", branch]) === null) {
      console.log(`${repo.name}/${branch} was already gone upstream.`);
    } else {
      console.log(`Deleted ${repo.name}/${branch}.`);
    }
  }
}
rl?.close();
console.log("\nDone. Back on scaffold main.");
