// Shim for `isomorphic-webcrypto/src/react-native`, imported by
// lib0/dist/webcrypto.react-native.cjs. The real package is unmaintained and
// needs native config; we don't need it. lib0 only consumes getRandomValues
// (for yjs client IDs); `subtle` stays available if a global crypto provides
// it. getRandomValues is polyfilled in index.js via
// react-native-get-random-values, set on the global `crypto`.
//
// Shape must match what webcrypto.react-native.cjs reads off the default:
// `.ensureSecure()`, `.subtle`, `.getRandomValues`.
module.exports = {
  ensureSecure() {},
  get subtle() {
    return globalThis.crypto ? globalThis.crypto.subtle : undefined;
  },
  getRandomValues(array) {
    return globalThis.crypto.getRandomValues(array);
  },
};
