import sodium from 'react-native-libsodium';

/**
 * ADR-010: the fingerprint recorded on RoomKeyGrant.recipientKeyFp is
 * supplied by the uploader verbatim (never server-derived), computed over
 * the exact publicKey the uploader fetched and sealed against. Must match
 * the server's own User.publicKeyFp bit-for-bit for the pending-grant
 * comparison in RoomKeysService.getPending to work — BLAKE2b-512
 * (crypto_generichash, 64-byte output) matches Node's 'blake2b512', which
 * is what apps/server/src/users/users.service.ts uses (see that file's
 * deviation note: react-native-libsodium has no plain SHA-256 primitive).
 */
export function computePublicKeyFp(publicKeyBase64: string): string {
  return sodium.crypto_generichash(64, publicKeyBase64, null, 'hex');
}
