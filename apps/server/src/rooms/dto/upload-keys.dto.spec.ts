// UploadKeysDto uses class-transformer's @Type() for its nested/array
// fields, which needs decorator reflection metadata — unlike main.ts (which
// imports this at bootstrap), a standalone spec file has to bring it in
// itself.
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { createHash } from 'node:crypto';
import { UploadKeysDto } from './upload-keys.dto';

// A real 32-byte X25519 public key and a real 80-byte crypto_box_seal
// output, base64url-encoded (react-native-libsodium's default 'base64'
// output variant) — so length validation is exercised against genuinely
// correctly-shaped values, not just something that merely looks like base64.
const VALID_WRAPPED_KEY = Buffer.alloc(80, 7).toString('base64url');
const VALID_FP = createHash('blake2b512').update('anything').digest('hex');

function validGrant(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    keyId: 1,
    wrappedKey: VALID_WRAPPED_KEY,
    recipientKeyFp: VALID_FP,
    ...overrides,
  };
}

async function validateDto(dto: Record<string, unknown>) {
  return validate(plainToInstance(UploadKeysDto, dto));
}

describe('UploadKeysDto (code review round 1, Important #6)', () => {
  it('accepts a well-formed grants-only payload', async () => {
    const errors = await validateDto({ grants: [validGrant()] });
    expect(errors).toHaveLength(0);
  });

  it('accepts a well-formed claimEpoch payload', async () => {
    const errors = await validateDto({ claimEpoch: { expectedCurrentKeyId: 0 }, grants: [validGrant()] });
    expect(errors).toHaveLength(0);
  });

  it('rejects a wrappedKey that does not decode to exactly 80 bytes', async () => {
    const errors = await validateDto({ grants: [validGrant({ wrappedKey: Buffer.alloc(10).toString('base64url') })] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a recipientKeyFp that is not a 128-char lowercase hex digest', async () => {
    const errors = await validateDto({ grants: [validGrant({ recipientKeyFp: 'not-a-hex-digest' })] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a keyId above the sanity ceiling', async () => {
    const errors = await validateDto({ grants: [validGrant({ keyId: 1_000_000 })] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a grants array larger than the sanity cap', async () => {
    const grants = Array.from({ length: 1_001 }, () => validGrant());
    const errors = await validateDto({ grants });
    expect(errors.length).toBeGreaterThan(0);
  });
});
