import { repos, git } from "./lib.mjs";

const base = process.argv[2] ?? "origin/main";
const head = process.argv[3] ?? "HEAD";
const changed = git(["diff", "--name-only", `${base}...${head}`]).split("\n").filter(Boolean);
const bad = changed.filter((f) => repos.some((r) => f === r.prefix || f.startsWith(`${r.prefix}/`)));

if (bad.length) {
  console.error("Vendored sources must never target main. Offending paths:");
  for (const f of bad) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`main-guard: OK (${changed.length} changed files, none vendored)`);
