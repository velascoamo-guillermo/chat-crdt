// Marks dist/esm as an ESM subtree and adds an ESM-flavored type entry point.
// Needed because the package root has no "type" field (dist/ stays CJS by
// default), so Node must be told dist/esm/*.js are ES modules. The .d.mts
// re-export lets TS treat the "import" condition's types as ESM instead of
// inheriting the package's implied CJS type-declaration interop.
import { writeFileSync } from 'node:fs';

writeFileSync('dist/esm/package.json', JSON.stringify({ type: 'module' }, null, 2) + '\n');
writeFileSync('dist/esm/index.d.mts', "export * from '../index.js';\n");
