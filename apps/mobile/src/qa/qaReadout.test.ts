import { describe, it, expect } from 'bun:test';
import { isQaReadoutEnabled } from './qaReadout';

describe('isQaReadoutEnabled', () => {
  it('is on only for the exact build-time value "1"', () => {
    expect(isQaReadoutEnabled('1')).toBe(true);
  });

  it('stays off when the flag is absent (normal dev and release builds)', () => {
    expect(isQaReadoutEnabled(undefined)).toBe(false);
  });

  it('stays off for other truthy-looking values', () => {
    for (const value of ['', '0', 'true', 'yes', ' 1']) {
      expect(isQaReadoutEnabled(value)).toBe(false);
    }
  });
});
