import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const config = JSON.parse(readFileSync(join(ROOT, "mono.config.json"), "utf8"));
export const repos = config.repos;

// maxBuffer: git output can exceed Node's 1 MB default (e.g. `diff --name-only`
// against a vendored branch lists 20k+ files) — without this the wrapper dies
// with ENOBUFS instead of the caller's real error message.
const GIT_MAX_BUFFER = 1024 * 1024 * 1024;

export function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER }).trim();
}

// mono:push splits each subtree with josh-filter (josh-project/josh). The
// :rev() stage declares the vendored upstream history "already the subtree"
// (prefix→extract is the identity, so those commits keep their original
// SHAs), and only our commits above the cut-line are re-minted on top of the
// real upstream tip. Deterministic for a given josh version — pin the version
// (README) so teammate pushes fast-forward each other. Seconds, even on the
// first push; `git subtree split` walked the entire vendored history with a
// subprocess per commit (~45 min) and segfaulted bash 5.3 on the way.
export function joshFilter() {
  const bin = process.env.JOSH_FILTER || "josh-filter";
  try {
    execFileSync(bin, ["--help"], { stdio: "ignore" });
  } catch {
    die("josh-filter not found — see README 'Requirements' for install (or set JOSH_FILTER to the binary).");
  }
  return bin;
}

export function joshSplit(repo, cutline) {
  const out = execFileSync(
    joshFilter(),
    [`:rev(<=${cutline}:prefix=${repo.prefix}):/${repo.prefix}`, "HEAD", "--update", `refs/mono/split/${repo.prefix}`],
    { cwd: ROOT, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER }
  ).trim();
  const split = out.split("\n").pop().trim();
  if (!/^[0-9a-f]{40}$/.test(split)) {
    die(`${repo.name}: josh-filter returned unexpected output:\n${out}`);
  }
  // The split tip's tree must equal the vendored directory exactly; refuse to
  // push anything that fails this.
  if (!gitOk(["diff", "--quiet", split, `HEAD:${repo.prefix}`])) {
    die(`${repo.name}: split content mismatch (josh-filter ${split} != HEAD:${repo.prefix}) — not pushing.`);
  }
  return split;
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
  run("git", ["fetch", "--quiet", "--prune", repo.name]);
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
