import { repos, run, gitOk, die, ensureClean, ensureOnFeatureBranch, fetchRepo, remoteBranch, currentBranch } from "./lib.mjs";

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
  try {
    run("git", ["merge", "-X", `subtree=${repo.prefix}`, "-m", `Merge ${repo.name}/${ref} into ${repo.prefix}/`, tip]);
  } catch {
    die(`${repo.name}: merge stopped — likely conflicts in ${repo.prefix}/ (see above). Resolve them, then 'git add -A && git commit', and re-run 'pnpm mono:pull'.`);
  }
}

console.log("\nDone. If pnpm-lock or deps changed upstream, run: pnpm install");
