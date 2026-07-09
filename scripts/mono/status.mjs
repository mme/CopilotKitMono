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
  const upToDate = tip && tryGit(["rev-parse", `${tip}^{tree}`]) === localTree;

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
  console.log(`  our commits since cut-line ${cut.slice(0, 7)}: ${upToDate ? `0 unpushed (${ours} pushed)` : ours}`);
  console.log(`  upstream '${branch}': ${pushed}`);
  console.log(`  ${pr}`);
  if (tip && !gitOk(["merge-base", "--is-ancestor", tip, "HEAD"])) {
    console.log(`  note: upstream has commits not in this branch — run 'pnpm mono:pull'.`);
  }
}
