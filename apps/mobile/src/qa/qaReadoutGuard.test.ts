import { describe, it, expect } from 'bun:test';
import { qaReadoutBuildError } from '../../config/qaReadoutGuard';

// argv as react-native-xcode.sh / the RN Gradle plugin invoke Expo CLI for a
// Release bundle.
const releaseEmbed = [
  'node', '/x/@expo/cli/build/bin/cli', 'export:embed',
  '--platform', 'ios', '--dev', 'false', '--minify', 'true',
];
const QA = { EXPO_PUBLIC_QA_READOUT: '1' };
const TOKEN = '3f2b9c1e-7a4d-4e8b-9c0f-1a2b3c4d5e6f';

describe('qaReadoutBuildError', () => {
  it('blocks a release bundle that has the QA flag but no e2e token', () => {
    expect(qaReadoutBuildError({ argv: releaseEmbed, env: QA })).toContain(
      'EXPO_PUBLIC_QA_READOUT',
    );
  });

  it('blocks `expo export` (production by default) with the flag', () => {
    const argv = ['node', 'cli', 'export', '--platform', 'android'];
    expect(qaReadoutBuildError({ argv, env: QA })).not.toBeNull();
  });

  it('blocks the `--dev=false` spelling too', () => {
    const argv = ['node', 'cli', 'export:embed', '--dev=false'];
    expect(qaReadoutBuildError({ argv, env: QA })).not.toBeNull();
  });

  it('allows the flag in the e2e build (env matches the per-run token)', () => {
    const env = { ...QA, CHATCRDT_E2E_BUILD: TOKEN };
    expect(qaReadoutBuildError({ argv: releaseEmbed, env, e2eToken: TOKEN })).toBeNull();
  });

  it('blocks a static CHATCRDT_E2E_BUILD (e.g. from .env) that does not match the token', () => {
    const env = { ...QA, CHATCRDT_E2E_BUILD: '1' };
    expect(qaReadoutBuildError({ argv: releaseEmbed, env })).not.toBeNull();
    expect(qaReadoutBuildError({ argv: releaseEmbed, env, e2eToken: TOKEN })).not.toBeNull();
  });

  it('treats `export:embed` without --dev as a dev bundle (its default)', () => {
    const argv = ['node', 'cli', 'export:embed', '--platform', 'android'];
    expect(qaReadoutBuildError({ argv, env: QA })).toBeNull();
  });

  it('allows release bundles without the flag', () => {
    expect(qaReadoutBuildError({ argv: releaseEmbed, env: {} })).toBeNull();
  });

  it('allows the flag for the dev server and dev bundles', () => {
    expect(qaReadoutBuildError({ argv: ['node', 'cli', 'start'], env: QA })).toBeNull();
    const devEmbed = ['node', 'cli', 'export:embed', '--dev', 'true'];
    expect(qaReadoutBuildError({ argv: devEmbed, env: QA })).toBeNull();
    const devExport = ['node', 'cli', 'export', '--dev'];
    expect(qaReadoutBuildError({ argv: devExport, env: QA })).toBeNull();
  });
});
