import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * ADR-010 DTO hardening (code review round 1, Important #6). These decode
 * the base64 payload to check its actual byte length rather than trusting
 * string length alone — react-native-libsodium's default 'base64' output
 * variant is URL-safe, unpadded (base64url), so decoding must use Node's
 * 'base64url' encoding to get the right byte count for both that and
 * ordinary padded/standard base64 a test or another client might send.
 */
function decodedByteLength(value: string): number | null {
  try {
    if (!/^[A-Za-z0-9_=-]+$/.test(value)) return null;
    return Buffer.from(value, 'base64url').length;
  } catch {
    return null;
  }
}

function exactDecodedLengthValidator(name: string, expectedBytes: number, label: string) {
  @ValidatorConstraint({ name, async: false })
  class Constraint implements ValidatorConstraintInterface {
    validate(value: unknown): boolean {
      if (typeof value !== 'string' || value.length === 0) return false;
      const len = decodedByteLength(value);
      return len === expectedBytes;
    }
    defaultMessage(): string {
      return `${label} must be a base64-encoded value that decodes to exactly ${expectedBytes} bytes`;
    }
  }
  return Constraint;
}

// X25519 public key — crypto_box_keypair, 32 raw bytes.
const IsX25519PublicKeyConstraint = exactDecodedLengthValidator(
  'isX25519PublicKeyBase64',
  32,
  'publicKey',
);

export function IsX25519PublicKeyBase64(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isX25519PublicKeyBase64',
      target: object.constructor,
      propertyName,
      options,
      validator: IsX25519PublicKeyConstraint,
    });
  };
}

// crypto_box_seal(roomKey, recipientPublicKey) — the room key is
// crypto_aead_xchacha20poly1305_ietf's 32-byte key, plus crypto_box_seal's
// SEALBYTES overhead (crypto_box_PUBLICKEYBYTES (32) + crypto_box_MACBYTES
// (16) = 48) = 80 bytes total.
const IsWrappedRoomKeyConstraint = exactDecodedLengthValidator(
  'isWrappedRoomKeyBase64',
  80,
  'wrappedKey',
);

export function IsWrappedRoomKeyBase64(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isWrappedRoomKeyBase64',
      target: object.constructor,
      propertyName,
      options,
      validator: IsWrappedRoomKeyConstraint,
    });
  };
}
