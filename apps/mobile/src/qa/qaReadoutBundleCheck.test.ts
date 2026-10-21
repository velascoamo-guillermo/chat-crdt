import { describe, expect, it } from 'bun:test';
import { QA_READOUT_BUNDLE_MARKER } from '../../config/e2eBuildToken';
import { addQaReadoutBundleCheck } from '../../config/withQaReadoutBundleCheck';

const GRADLE = 'apply plugin: "com.android.application"\n\nandroid {\n}\n';

describe('addQaReadoutBundleCheck', () => {
  const out = addQaReadoutBundleCheck(GRADLE);

  it('keeps the existing build.gradle and appends the check', () => {
    expect(out.startsWith(GRADLE)).toBe(true);
    expect(out.length).toBeGreaterThan(GRADLE.length);
  });

  it('makes the QA flag and the e2e token inputs of the release bundle task', () => {
    // Without these, Gradle reuses an e2e bundle for a later normal release.
    expect(out).toContain('createBundle');
    expect(out).toContain('inputs.property');
    expect(out).toContain('providers.environmentVariable("EXPO_PUBLIC_QA_READOUT")');
    expect(out).toContain('providers.environmentVariable("CHATCRDT_E2E_BUILD")');
  });

  it('fails the bundle task on the marker unless it is the e2e build', () => {
    expect(out).toContain('doLast');
    expect(out).toContain(`"${QA_READOUT_BUNDLE_MARKER}"`);
    expect(out).toContain('.e2e-build-token');
    expect(out.match(/throw new GradleException/g)?.length).toBe(2);
  });

  it('is idempotent across prebuilds', () => {
    expect(addQaReadoutBundleCheck(out)).toBe(out);
  });
});

describe('QA_READOUT_BUNDLE_MARKER', () => {
  it('is what [roomId].tsx folds to when EXPO_PUBLIC_QA_READOUT=1', () => {
    expect(QA_READOUT_BUNDLE_MARKER).toBe('chatcrdt-qa-readout:1');
  });
});
