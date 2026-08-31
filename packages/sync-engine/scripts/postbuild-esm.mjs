// Post-processes the ESM build (tsc -p tsconfig.esm.json, moduleResolution
// "bundler") into a build that genuinely loads under plain Node ESM.
//
// Two problems tsc's "bundler" resolution leaves behind:
//   1. Relative specifiers are emitted WITHOUT an extension (e.g.
//      `from './SyncEngine'`). Node's ESM resolver requires an explicit
//      extension for relative imports — without this rewrite,
//      `import('@chat-crdt/sync-engine')` throws ERR_MODULE_NOT_FOUND.
//   2. The package root has no "type" field (so dist/*.js stays CJS by
//      default); dist/esm needs its own package.json marking it "module".
//
// All paths are resolved from this script's own location, not process.cwd(),
// so `node scripts/postbuild-esm.mjs` behaves the same regardless of the
// working directory it's invoked from.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
const esmDir = join(pkgRoot, 'dist', 'esm');

const HAS_EXTENSION = /\.(mjs|cjs|js|json|node)$/;
// Matches the specifier inside `from '...'`, `export * from "..."`, and
// dynamic `import('...')` — the only import forms tsc emits here.
const SPECIFIER = /((?:\bfrom\s+|\bimport\(\s*)['"])(\.\.?\/[^'"]+)(['"])/g;

function addJsExtension(source) {
  return source.replace(SPECIFIER, (full, prefix, spec, suffix) => {
    if (HAS_EXTENSION.test(spec)) return full;
    return `${prefix}${spec}.js${suffix}`;
  });
}

function rewriteDir(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteDir(full);
    } else if (entry.name.endsWith('.js')) {
      const original = readFileSync(full, 'utf8');
      const rewritten = addJsExtension(original);
      if (rewritten !== original) writeFileSync(full, rewritten);
    }
  }
}

rewriteDir(esmDir);
writeFileSync(join(esmDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');
// Re-export the CJS declaration file under an .mts extension so the "import"
// condition's types resolve as ESM instead of inheriting the package's
// implied CJS type-declaration interop (tsc/attw treat plain .d.ts as CJS
// when the nearest package.json has no "type": "module").
writeFileSync(join(esmDir, 'index.d.mts'), "export * from '../index.js';\n");
