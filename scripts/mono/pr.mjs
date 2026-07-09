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
  const out = gh(["pr", "list", "--repo", repo.ghRepo, "--head", branch, "--state", "open",
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
if (!only && (opt("--title") || opt("--body-file"))) {
  die("--title/--body-file need --repo <name> — PR titles and bodies are per-repo.");
}

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
