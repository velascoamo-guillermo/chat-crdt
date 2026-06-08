// Polyfill global crypto.getRandomValues before anything pulls in Yjs/lib0.
// lib0/random needs it; the redirect in metro.config.js points lib0's
// react-native webcrypto build at the browser build, which reads global crypto.
import 'react-native-get-random-values';
// Guarded atob/btoa for the sync-engine — installs only if the engine lacks them.
import './src/polyfills/base64';

import 'expo-router/entry';
