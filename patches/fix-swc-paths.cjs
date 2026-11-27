// Verify every relative require() in the swc output resolves, and repair the one
// way wasm diverges from the native binding: importing the package root a file
// sits inside emits "../models" instead of "..", which is MODULE_NOT_FOUND at
// boot. Checked against upstream's 1.10.1 image -- 596 files, 8 differing, only
// this signature breaks. Anything else unresolvable fails the build; this is the
// safety net for the whole @swc/wasm substitution.
const fs = require("fs");
const path = require("path");

const root = process.argv[2];
if (!root) {
  console.error("usage: fix-swc-paths.cjs <build-dir>");
  process.exit(1);
}

const resolves = (from, spec) => {
  const p = path.resolve(path.dirname(from), spec);
  return fs.existsSync(`${p}.js`) || fs.existsSync(path.join(p, "index.js")) ||
    (fs.existsSync(p) && fs.statSync(p).isFile());
};

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".js") ? [p] : [];
  });

let repaired = 0;
const unresolved = [];

for (const file of walk(root)) {
  const before = fs.readFileSync(file, "utf8");
  const after = before.replace(/require\((["'])(\.[^"']*)\1\)/g, (match, q, spec) => {
    // build.js compiles with --ignore "**/__mocks__/**"; upstream's image leaves
    // the same references dangling.
    if (resolves(file, spec) || spec.includes("__mocks__")) return match;
    const parent = path.posix.dirname(spec.replace(/\/+$/, ""));
    const base = path.posix.basename(spec.replace(/\/+$/, ""));
    const target = path.resolve(path.dirname(file), parent);
    if (base && path.basename(target) === base && resolves(file, parent)) {
      repaired++;
      return `require(${q}${parent}${q})`;
    }
    unresolved.push(`${path.relative(root, file)} -> ${spec}`);
    return match;
  });
  if (after !== before) fs.writeFileSync(file, after);
}

if (unresolved.length) {
  console.error(`UNRESOLVED REQUIRES (${unresolved.length}) in ${root}:`);
  unresolved.slice(0, 20).forEach((u) => console.error(`  ${u}`));
  process.exit(1);
}
console.log(`swc path check: ${repaired} repaired, all requires resolve`);
