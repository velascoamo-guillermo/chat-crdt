import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

import { withReleaseIosConfig } from '../../config/releaseIosConfig';

const MOBILE_DIR = join(import.meta.dir, '../..');

const base = {
  name: 'chat-crdt',
  slug: 'chat-crdt',
  ios: { supportsTablet: false, bundleIdentifier: 'com.chatcrdt.app' },
};

describe('withReleaseIosConfig', () => {
  it('leaves the config alone without release env (dev and e2e builds)', () => {
    expect(withReleaseIosConfig(base, {})).toEqual(base);
  });

  it('sets the signing team so manual match signing resolves', () => {
    const out = withReleaseIosConfig(base, { APPLE_TEAM_ID: 'AB12CD34EF' });
    expect(out.ios).toEqual({ ...base.ios, appleTeamId: 'AB12CD34EF' });
  });

  it('sets the build number TestFlight needs to grow on every upload', () => {
    const out = withReleaseIosConfig(base, { IOS_BUILD_NUMBER: '202610231530' });
    expect(out.ios?.buildNumber).toBe('202610231530');
  });

  it('rejects a build number App Store Connect would refuse', () => {
    expect(() => withReleaseIosConfig(base, { IOS_BUILD_NUMBER: 'v1' })).toThrow('IOS_BUILD_NUMBER');
  });
});

describe('app.config.js', () => {
  it('applies the release env on top of app.json', () => {
    const saved = { ...process.env };
    process.env.APPLE_TEAM_ID = 'AB12CD34EF';
    process.env.IOS_BUILD_NUMBER = '7';
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const appConfig = require(join(MOBILE_DIR, 'app.config.js'));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const appJson = require(join(MOBILE_DIR, 'app.json'));
      const out = appConfig({ config: appJson.expo });
      expect(out.ios.appleTeamId).toBe('AB12CD34EF');
      expect(out.ios.buildNumber).toBe('7');
      expect(out.plugins).toEqual(appJson.expo.plugins);
    } finally {
      delete process.env.APPLE_TEAM_ID;
      delete process.env.IOS_BUILD_NUMBER;
      Object.assign(process.env, saved);
    }
  });
});
