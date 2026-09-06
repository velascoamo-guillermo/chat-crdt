import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SetPublicKeyDto } from './set-public-key.dto';

const VALID_PUBLIC_KEY = Buffer.alloc(32, 3).toString('base64url'); // real 32-byte X25519 key shape

async function validatePublicKey(publicKey: unknown) {
  return validate(plainToInstance(SetPublicKeyDto, { publicKey }));
}

describe('SetPublicKeyDto (code review round 1, Important #6)', () => {
  it('accepts a base64url-encoded 32-byte key', async () => {
    const errors = await validatePublicKey(VALID_PUBLIC_KEY);
    expect(errors).toHaveLength(0);
  });

  it('accepts a standard-base64-encoded (padded) 32-byte key too', async () => {
    const errors = await validatePublicKey(Buffer.alloc(32, 3).toString('base64'));
    expect(errors).toHaveLength(0);
  });

  it('rejects a key that does not decode to exactly 32 bytes', async () => {
    const errors = await validatePublicKey(Buffer.alloc(16, 3).toString('base64url'));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an empty string', async () => {
    const errors = await validatePublicKey('');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-string value', async () => {
    const errors = await validatePublicKey(12345);
    expect(errors.length).toBeGreaterThan(0);
  });
});
