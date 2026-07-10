// Utility (run manually, not wired into any workflow): regenerates the root
// pnpm-workspace.yaml from the vendored repos' own pnpm-workspace.yaml files
// (globs prefixed with each repo's directory). The root file is
// hand-maintained; when upstream restructures its layout and installs start
// failing, run this instead of hand-typing the new globs, then commit.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, repos, die } from "./lib.mjs";

// List keys copied through un-prefixed and unioned across repos. Anything
// else in a vendored workspace file is reported but not mirrored.
const SHARED_LIST_KEYS = ["onlyBuiltDependencies", "ignoredBuiltDependencies"];

export function parseWorkspaceLists(text) {
  const lists = {};
  const otherKeys = [];
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/(^|\s)#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    let m;
    if ((m = line.match(/^([\w-]+):\s*$/))) {
      current = m[1];
      lists[current] ??= [];
    } else if ((m = line.match(/^\s+-\s*(.+)$/)) && current) {
      lists[current].push(m[1].trim().replace(/^(['"])(.*)\1$/, "$2"));
    } else if ((m = line.match(/^([\w-]+):/))) {
      current = null;
      otherKeys.push(m[1]);
    }
  }
  return { lists, otherKeys };
}

export function syncWorkspace(root = ROOT) {
  const globs = [];
  const shared = Object.fromEntries(SHARED_LIST_KEYS.map((k) => [k, new Set()]));
  let found = 0;
  for (const repo of repos) {
    const file = join(root, repo.prefix, "pnpm-workspace.yaml");
    if (!existsSync(file)) {
      console.log(`sync-workspace: no ${repo.prefix}/pnpm-workspace.yaml — skipping ${repo.name}.`);
      continue;
    }
    found++;
    const { lists, otherKeys } = parseWorkspaceLists(readFileSync(file, "utf8"));
    for (const g of lists.packages ?? []) {
      globs.push(g.startsWith("!") ? `!${repo.prefix}/${g.slice(1)}` : `${repo.prefix}/${g}`);
    }
    for (const k of SHARED_LIST_KEYS) {
      for (const v of lists[k] ?? []) shared[k].add(v);
    }
    const unmirrored = [...new Set([...otherKeys, ...Object.keys(lists).filter((k) => k !== "packages" && !SHARED_LIST_KEYS.includes(k))])];
    if (unmirrored.length) {
      console.log(`sync-workspace: note — keys in ${repo.prefix}/pnpm-workspace.yaml not mirrored to the root workspace: ${unmirrored.join(", ")}`);
    }
  }
  if (!found) die("no vendored pnpm-workspace.yaml found — run this on a vendored feature branch.");

  let out = "# Generated from the vendored repos' own pnpm-workspace.yaml files by\n";
  out += "# scripts/mono/sync-workspace.mjs (run by 'pnpm mono:branch'). Re-run it if\n";
  out += "# upstream's workspace layout changes; don't edit the globs by hand.\n";
  out += "packages:\n";
  for (const g of globs) out += `  - "${g}"\n`;
  for (const k of SHARED_LIST_KEYS) {
    if (shared[k].size === 0) continue;
    out += `${k}:\n`;
    for (const v of [...shared[k]].sort()) out += `  - ${v}\n`;
  }
  writeFileSync(join(root, "pnpm-workspace.yaml"), out);
  console.log(`sync-workspace: wrote pnpm-workspace.yaml (${globs.length} globs from ${found} repo(s)).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncWorkspace(process.argv[2] ?? ROOT);
}
