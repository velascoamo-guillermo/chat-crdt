// Release-only iOS settings for the TestFlight build (scripts/release-ios.sh).
//
// The fastlane lane runs `expo prebuild --clean`, so ios/ is regenerated from
// the Expo config on every release: whatever signing or versioning the build
// needs has to come from here. Both values come from the environment so
// app.json stays free of account data:
//   APPLE_TEAM_ID     -> DEVELOPMENT_TEAM, which xcodebuild's manual (match)
//                        signing needs to resolve the profile.
//   IOS_BUILD_NUMBER  -> CFBundleVersion. TestFlight refuses a build number it
//                        already has, and rn-workflows only bumps it for `ota`
//                        profiles.
// Without either variable (dev, Maestro e2e builds) the config is unchanged.
// Plain CJS: app.config.js requires it and bun tests import it.

const BUILD_NUMBER = /^\d+(\.\d+){0,2}$/;

/**
 * @template {{ ios?: Record<string, unknown> }} T
 * @param {T} config
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {T}
 */
function withReleaseIosConfig(config, env) {
  const ios = { ...config.ios };
  if (env.APPLE_TEAM_ID) {
    ios.appleTeamId = env.APPLE_TEAM_ID;
  }
  if (env.IOS_BUILD_NUMBER) {
    if (!BUILD_NUMBER.test(env.IOS_BUILD_NUMBER)) {
      throw new Error(
        `IOS_BUILD_NUMBER "${env.IOS_BUILD_NUMBER}" must be up to three dot-separated integers, e.g. 202610231530.`,
      );
    }
    ios.buildNumber = env.IOS_BUILD_NUMBER;
  }
  if (!env.APPLE_TEAM_ID && !env.IOS_BUILD_NUMBER) {
    return config;
  }
  return { ...config, ios };
}

module.exports = { withReleaseIosConfig };
