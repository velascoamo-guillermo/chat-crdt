import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isE2eBuild, readE2eBuildToken } from '../../config/e2eBuildToken';

const TOKEN = '3f2b9c1e-7a4d-4e8b-9c0f-1a2b3c4d5e6f';

describe('isE2eBuild', () => {
  it('is true only when the env value matches the per-run token file', () => {
    expect(isE2eBuild({ CHATCRDT_E2E_BUILD: TOKEN }, TOKEN)).toBe(true);
  });

  it('rejects a static value such as one from a .env file', () => {
    expect(isE2eBuild({ CHATCRDT_E2E_BUILD: '1' }, TOKEN)).toBe(false);
    expect(isE2eBuild({ CHATCRDT_E2E_BUILD: '1' }, '1')).toBe(false);
  });

  it('is false without a token file, even if the env is set', () => {
    expect(isE2eBuild({ CHATCRDT_E2E_BUILD: TOKEN }, null)).toBe(false);
  });

  it('is false without the env value', () => {
    expect(isE2eBuild({}, TOKEN)).toBe(false);
  });
});

describe('readE2eBuildToken', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'e2e-token-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the trimmed token build-e2e.sh wrote', () => {
    writeFileSync(join(dir, '.e2e-build-token'), `${TOKEN}\n`);
    expect(readE2eBuildToken(dir)).toBe(TOKEN);
  });

  it('is null when no e2e build is running', () => {
    expect(readE2eBuildToken(dir)).toBeNull();
  });
});
