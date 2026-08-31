/**
 * ADR-010: injected cipher interface. Lives in @chat-crdt/sync-engine as a
 * plain TypeScript type with no crypto dependency — the concrete libsodium
 * implementation is constructed and injected by the app layer, which is the
 * only place that touches expo-secure-store and key material. The engine
 * itself never imports react-native-libsodium (ADR-005 extractability).
 */
export interface MessageAad {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  createdAt: number;
}

export interface ContentCipher {
  /** Returns the 'E2E1'-prefixed envelope. */
  encrypt(plaintext: string, ad: MessageAad): string;
  /** Throws on AD/key mismatch. Declared for a symmetric contract even
   *  though the engine itself never calls it — see "the read path stays
   *  app-side" in ADR-010; the app layer uses the same injected instance. */
  decrypt(content: string, ad: MessageAad): string;
}
