import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The guard and the plugins only protect a release if they're hooked up. These
// tests load the real metro.config.js and app.json, so unhooking either fails.
const MOBILE_DIR = join(import.meta.dir, '../..');
const METRO_CONFIG = join(MOBILE_DIR, 'metro.config.js');

// metro.config.js reads process.argv/env at load, like Expo CLI's in-process Metro.
const loadMetroConfig = (argv: readonly string[], env: Record<string, string>): unknown => {
  const savedArgv = [...process.argv];
  const savedEnv = { ...process.env };
  process.argv.push(...argv);
  Object.assign(process.env, env);
  delete require.cache[METRO_CONFIG];
  try {
    // CJS require so the cache delete above forces a fresh load each time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(METRO_CONFIG);
  } finally {
    process.argv.splice(0, process.argv.length, ...savedArgv);
    for (const key of Object.keys(env)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    delete require.cache[METRO_CONFIG];
  }
};

describe('metro.config.js runs the QA readout guard', () => {
  const release = ['export:embed', '--platform', 'android', '--dev', 'false'];

  it('fails a release bundle that has the QA flag', () => {
    expect(() => loadMetroConfig(release, { EXPO_PUBLIC_QA_READOUT: '1' })).toThrow(
      'EXPO_PUBLIC_QA_READOUT=1 is set for a production bundle',
    );
  });

  it('loads for the same release bundle without the flag', () => {
    expect(loadMetroConfig(release, {})).toHaveProperty('resolver');
  });
});

describe('app.json registers the release-safety plugins', () => {
  const appJson = JSON.parse(readFileSync(join(MOBILE_DIR, 'app.json'), 'utf8')) as {
    expo: { plugins: (string | [string, unknown])[] };
  };
  const plugins = appJson.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));

  it.each([
    './config/withE2eLocalhostCleartext',
    './config/withQaReadoutBundleCheck',
  ])('lists %s and it exports a config plugin', async (plugin) => {
    expect(plugins).toContain(plugin);
    const mod = (await import(join(MOBILE_DIR, plugin))) as { default: unknown };
    expect(typeof mod.default).toBe('function');
  });
});
