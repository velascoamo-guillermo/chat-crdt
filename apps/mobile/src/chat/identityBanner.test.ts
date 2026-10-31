import { describe, it, expect } from 'bun:test';
import type { IdentityStatus } from '../crypto/keyFlows';
import { IDENTITY_BANNER_COPY, resetDeviceKeyFlow, showIdentityBanner } from './identityBanner';

describe('showIdentityBanner (T15 fix 2)', () => {
  it('shows only when this device holds a different key than the published one', () => {
    const statuses: (IdentityStatus | null)[] = [null, 'ok', 'published', 'adopted-legacy', 'republished', 'mismatch'];
    expect(statuses.filter(showIdentityBanner)).toEqual(['mismatch']);
  });
});

describe('IDENTITY_BANNER_COPY', () => {
  it('warns before the reset that the other device loses access to encrypted history', () => {
    expect(IDENTITY_BANNER_COPY.confirmBody).toMatch(/other device/i);
    expect(IDENTITY_BANNER_COPY.confirmBody).toMatch(/history/i);
  });
});

describe('resetDeviceKeyFlow', () => {
  function harness(opts: { confirm: boolean; after: IdentityStatus | null; resetThrows?: boolean }) {
    let status: IdentityStatus | null = 'mismatch';
    const calls: string[] = [];
    const run = () =>
      resetDeviceKeyFlow({
        confirm: async () => {
          calls.push('confirm');
          return opts.confirm;
        },
        reset: async () => {
          calls.push('reset');
          if (opts.resetThrows) throw new Error('offline');
          status = opts.after;
        },
        getStatus: () => status,
      });
    return { run, calls };
  }

  it('does nothing when the user cancels the confirmation', async () => {
    const h = harness({ confirm: false, after: 'republished' });

    expect(await h.run()).toBe('cancelled');
    expect(h.calls).toEqual(['confirm']);
  });

  it('republishes after the user confirms', async () => {
    const h = harness({ confirm: true, after: 'republished' });

    expect(await h.run()).toBe('done');
    expect(h.calls).toEqual(['confirm', 'reset']);
  });

  it('reports a failure when the device is still mismatched afterwards', async () => {
    expect(await harness({ confirm: true, after: 'mismatch' }).run()).toBe('failed');
  });

  it('reports a failure when the reset throws', async () => {
    expect(await harness({ confirm: true, after: 'republished', resetThrows: true }).run()).toBe('failed');
  });
});
