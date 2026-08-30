// Loads TypeScript modules from src/lib into plain Node, for the standalone
// eval and test scripts.
//
// WHY IT WORKS THE WAY IT DOES
// Two simpler approaches were tried and both broke:
//
//   1. Stripping types with regexes — choked on optional parameters
//      (`subject?: string`), and would break again on every syntax feature.
//   2. Transpiling to an ESM data: URL — cannot resolve relative imports,
//      so any module importing "./llm" failed with ERR_UNSUPPORTED_RESOLVE_REQUEST.
//
// So: transpile the whole lib directory to CommonJS in a temp dir and require
// from there. CommonJS resolves extensionless relative specifiers ("./llm" →
// "./llm.js") natively, which is exactly the thing ESM would not do.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LIB_DIR = join(ROOT, "src", "lib");

// Output lands under the project's own node_modules/.cache rather than the OS
// temp dir. It has to: llm.ts requires "openai", and Node resolves bare
// specifiers by walking up from the importing file. From /tmp there is no
// node_modules to find, so the require fails. From inside the project tree it
// walks up to <repo>/node_modules and resolves. .cache is already gitignored
// by convention and is wiped by a clean install.
const OUT_DIR = join(ROOT, "node_modules", ".cache", "tradeladder-lib");

let cachedRequire = null;

/**
 * Transpile src/lib once and return a require() rooted in the output dir.
 * Subsequent calls reuse the same build.
 */
export async function libRequire() {
  if (cachedRequire) return cachedRequire;

  const ts = (await import("typescript")).default;
  const outDir = OUT_DIR;
  mkdirSync(outDir, { recursive: true });

  for (const file of readdirSync(LIB_DIR).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(LIB_DIR, file), "utf8");
    const { outputText } = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: file,
    });
    writeFileSync(join(outDir, basename(file, ".ts") + ".js"), outputText, "utf8");
  }

  // Rooted at a file inside outDir so "./name" resolves against it.
  cachedRequire = createRequire(join(outDir, "index.js"));
  return cachedRequire;
}

/** Load one lib module by name, e.g. loadLib("verify-levels"). */
export async function loadLib(name) {
  const req = await libRequire();
  return req(`./${name}.js`);
}
