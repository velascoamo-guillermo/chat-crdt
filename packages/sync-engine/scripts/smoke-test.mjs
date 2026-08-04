// Publish-readiness smoke test.
//
// publint / attw / `npm pack --dry-run` only inspect package.json and file
// lists — none of them execute a single line of the published code. That's
// exactly how a broken ESM build (extensionless relative imports under
// Node's ESM resolver) and a leaked `workspace:*` dependency specifier both
// slipped through review. This script is the one check that would have
// caught both: it packs @chat-crdt/shared and @chat-crdt/sync-engine as real
// npm tarballs, installs them (plus the yjs peer dep) into an isolated temp
// project with NO workspace/monorepo context, then require()s AND import()s
// the installed package under real Node, asserting the expected exports
// exist.
/* global console */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const syncEngineDir = join(__dirname, '..');
const sharedDir = join(syncEngineDir, '..', 'shared');

const EXPECTED_EXPORTS = ['SyncEngine', 'WebSocketProvider', 'SQLitePersistence', 'MemoryStorage'];

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' });
}

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

let tmpDir;
let sharedTarballPath;
let syncEngineTarballPath;

try {
  log('building @chat-crdt/shared and @chat-crdt/sync-engine (fresh dist)...');
  run('bun', ['run', 'build'], sharedDir);
  run('bun', ['run', 'build'], syncEngineDir);

  log('packing tarballs...');
  const sharedTarball = run('npm', ['pack', '--silent'], sharedDir).trim().split('\n').pop();
  const syncEngineTarball = run('npm', ['pack', '--silent'], syncEngineDir).trim().split('\n').pop();
  sharedTarballPath = join(sharedDir, sharedTarball);
  syncEngineTarballPath = join(syncEngineDir, syncEngineTarball);

  if (!existsSync(sharedTarballPath) || !existsSync(syncEngineTarballPath)) {
    throw new Error('npm pack did not produce the expected tarball(s)');
  }

  tmpDir = mkdtempSync(join(tmpdir(), 'sync-engine-smoke-'));
  log(`installing tarballs + yjs peer dep into isolated project: ${tmpDir}`);
  writeFileSync(
    join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'sync-engine-smoke-consumer', private: true, version: '0.0.0' }, null, 2),
  );
  // Passing the local tarballs alongside "yjs@..." in one install lets npm
  // satisfy sync-engine's "@chat-crdt/shared": "^0.1.0" dependency from the
  // local shared tarball instead of hitting the registry for a package that
  // (deliberately) isn't published there in this test.
  run(
    'npm',
    ['install', '--no-audit', '--no-fund', '--silent', sharedTarballPath, syncEngineTarballPath, 'yjs@^13.6.0'],
    tmpDir,
  );

  const assertExports = (label, exportNames) => {
    const missing = EXPECTED_EXPORTS.filter((name) => !exportNames.includes(name));
    if (missing.length > 0) {
      throw new Error(`${label}: missing export(s) ${missing.join(', ')} (got: ${exportNames.join(', ')})`);
    }
    log(`${label} OK — exports: ${exportNames.join(', ')}`);
  };

  writeFileSync(
    join(tmpDir, 'probe.cjs'),
    `const mod = require('@chat-crdt/sync-engine');\nconsole.log(JSON.stringify(Object.keys(mod)));\n`,
  );
  const cjsExports = JSON.parse(run('node', ['probe.cjs'], tmpDir).trim());
  assertExports('CJS require()', cjsExports);

  writeFileSync(
    join(tmpDir, 'probe.mjs'),
    `import * as mod from '@chat-crdt/sync-engine';\nconsole.log(JSON.stringify(Object.keys(mod)));\n`,
  );
  const esmExports = JSON.parse(run('node', ['probe.mjs'], tmpDir).trim());
  assertExports('ESM import()', esmExports);

  log('PASS — both tarballs install and load under real Node (CJS + ESM), with the declared exports.');
} finally {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  if (sharedTarballPath) rmSync(sharedTarballPath, { force: true });
  if (syncEngineTarballPath) rmSync(syncEngineTarballPath, { force: true });
}
