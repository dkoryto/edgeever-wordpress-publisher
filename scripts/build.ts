import { build } from "esbuild";
import { readFileSync, statSync } from "node:fs";

function manifestBanner() {
  const { name, version } = JSON.parse(readFileSync("manifest.json", "utf8"));
  const marked = JSON.parse(readFileSync("node_modules/marked/package.json", "utf8")).version;
  return `${name} ${version} | MIT License | Source: see README.md | Bundles marked ${marked} (MIT License, Copyright (c) 2018+ MarkedJS, Copyright (c) 2011-2018 Christopher Jeffrey)`;
}

await build({
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: false,
  legalComments: "inline",
  banner: {
    js: `/*! ${manifestBanner()} */`,
  },
  charset: "utf8",
  logLevel: "info",
});

// EdgeEver requires a single-file bundle without relative or bare module imports.
const output = readFileSync("main.js", "utf8");
const imports = output.match(/^\s*import\s.+from\s+["'][^"']+["']/gm) ?? [];
if (imports.length > 0 || /\bimport\(\s*["']/.test(output)) {
  throw new Error(`main.js must not contain module imports:\n${imports.join("\n")}`);
}
if (!/export\s*\{[^}]*\bas default\b|export default/.test(output)) {
  throw new Error("main.js must have a default export.");
}
const size = statSync("main.js").size;
if (size > 5 * 1024 * 1024) throw new Error(`main.js is ${size} bytes; EdgeEver allows at most 5 MB.`);

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (manifest.version !== pkg.version) {
  throw new Error(`manifest.json version ${manifest.version} does not match package.json version ${pkg.version}.`);
}
console.log(`main.js: ${size} bytes, manifest ${manifest.id}@${manifest.version}`);
