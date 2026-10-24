// Adds ?v=<version> to every local .js/.css reference in the site, so a deploy never mixes a browser-cached
// old file with a new one (GitHub Pages lets browsers cache files for 10 minutes).
// Run by the deploy workflow on the copy it publishes:  node scripts/stamp-version.mjs web <version>
import fs from "node:fs";
import path from "node:path";

const [root = "web", version = Date.now().toString(36)] = process.argv.slice(2);
const v = encodeURIComponent(version.slice(0, 12));
const local = (spec) => !/^(https?:|\/\/|data:|#)/.test(spec) && /\.(m?js|css)$/.test(spec);
let files = 0, refs = 0;

for (const file of fs.readdirSync(root, { recursive: true })) {
  const full = path.join(root, file);
  if (!/\.(m?js|html)$/.test(file) || file.includes("vendor") || !fs.statSync(full).isFile()) continue;
  const src = fs.readFileSync(full, "utf8");
  const stamp = (q, spec) => (local(spec) ? (refs++, `${q}${spec}?v=${v}${q}`) : `${q}${spec}${q}`);
  const out = src
    // import x from "./a.js", export * from "./a.js", import "./a.js", import("./a.js")
    .replace(/(\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"'\n]+)\2/g, (m, pre, q, spec) => pre + stamp(q, spec))
    // <script src="..."> and <link href="...">
    .replace(/(\b(?:src|href)=)(["'])([^"'\n]+)\2/g, (m, pre, q, spec) => pre + stamp(q, spec));
  if (out !== src) { fs.writeFileSync(full, out); files++; }
}
console.log(`stamped ${refs} references in ${files} files with v=${v}`);
