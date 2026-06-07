// Polyfill global crypto.getRandomValues before anything pulls in Yjs/lib0.
// lib0/random needs it; the redirect in metro.config.js points lib0's
// react-native webcrypto build at the browser build, which reads global crypto.
import 'react-native-get-random-values';

import 'expo-router/entry';
