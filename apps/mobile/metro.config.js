const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch all packages in the monorepo
config.watchFolders = [monorepoRoot];

// Resolve modules from both the app's node_modules and the monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Ensure Metro resolves workspace packages correctly
config.resolver.disableHierarchicalLookup = false;

// lib0's "react-native" export condition makes its webcrypto build require the
// unmaintained `isomorphic-webcrypto` package (needs native config). We don't
// need it: yjs only uses getRandomValues, polyfilled globally in index.js via
// react-native-get-random-values. Redirect that require to a local shim backed
// by the global `crypto`.
const isomorphicWebcryptoShim = path.resolve(
  projectRoot,
  'shims/isomorphic-webcrypto.js',
);

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'isomorphic-webcrypto/src/react-native') {
    return { type: 'sourceFile', filePath: isomorphicWebcryptoShim };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
