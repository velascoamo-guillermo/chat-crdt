import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncE2eReleaseFiles } from '../../config/withE2eLocalhostCleartext';

const TOKEN = '3f2b9c1e-7a4d-4e8b-9c0f-1a2b3c4d5e6f';
const E2E = { CHATCRDT_E2E_BUILD: TOKEN };

let appDir: string;
const manifest = () => join(appDir, 'src/release/AndroidManifest.xml');
const nsc = () => join(appDir, 'src/release/res/xml/e2e_network_security_config.xml');

beforeEach(() => {
  appDir = mkdtempSync(join(tmpdir(), 'e2e-cleartext-'));
});
afterEach(() => {
  rmSync(appDir, { recursive: true, force: true });
});

describe('syncE2eReleaseFiles', () => {
  it('writes a release-only network config in an e2e build', () => {
    expect(syncE2eReleaseFiles(appDir, E2E, TOKEN)).toBe('written');
    expect(readFileSync(manifest(), 'utf8')).toContain(
      'android:networkSecurityConfig="@xml/e2e_network_security_config"',
    );
    expect(existsSync(nsc())).toBe(true);
  });

  it('permits cleartext for the local test hosts only, never the base config', () => {
    syncE2eReleaseFiles(appDir, E2E, TOKEN);
    const xml = readFileSync(nsc(), 'utf8');
    expect(xml).toMatch(/<base-config cleartextTrafficPermitted="false"/);
    const domains = [...xml.matchAll(/<domain[^>]*>([^<]+)<\/domain>/g)].map((m) => m[1]);
    expect(domains.sort()).toEqual(['10.0.2.2', '127.0.0.1', 'localhost']);
    expect(readFileSync(manifest(), 'utf8')).not.toContain('usesCleartextTraffic');
  });

  it('removes its own files in a normal build', () => {
    syncE2eReleaseFiles(appDir, E2E, TOKEN);
    expect(syncE2eReleaseFiles(appDir, {}, null)).toBe('removed');
    expect(existsSync(manifest())).toBe(false);
    expect(existsSync(nsc())).toBe(false);
  });

  it('leaves a release manifest it did not write alone in a normal build', () => {
    mkdirSync(join(appDir, 'src/release'), { recursive: true });
    writeFileSync(manifest(), '<manifest/>');
    expect(syncE2eReleaseFiles(appDir, {}, null)).toBe('untouched');
    expect(readFileSync(manifest(), 'utf8')).toBe('<manifest/>');
  });

  it('treats a static CHATCRDT_E2E_BUILD without the per-run token as a normal build', () => {
    syncE2eReleaseFiles(appDir, E2E, TOKEN);
    expect(syncE2eReleaseFiles(appDir, { CHATCRDT_E2E_BUILD: '1' }, null)).toBe('removed');
    expect(existsSync(nsc())).toBe(false);
  });

  it('refuses to overwrite a release manifest it did not write', () => {
    mkdirSync(join(appDir, 'src/release'), { recursive: true });
    writeFileSync(manifest(), '<manifest/>');
    expect(() => syncE2eReleaseFiles(appDir, E2E, TOKEN)).toThrow(/not written by/);
  });
});
