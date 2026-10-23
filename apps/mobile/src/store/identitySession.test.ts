import { describe, it, expect, beforeEach } from 'bun:test';
import type { IdentityStatus } from '../crypto/keyFlows';
import { makeSyncIdentity } from './identitySession';

describe('makeSyncIdentity (T15)', () => {
  let token: string | null;
  let statuses: IdentityStatus[];
  let syncCalls: string[];
  let nextSync: () => Promise<IdentityStatus>;
  let warnings: string[];

  const run = () =>
    makeSyncIdentity({
      getToken: () => token,
      setStatus: (s) => statuses.push(s),
      sync: (t) => {
        syncCalls.push(t);
        return nextSync();
      },
      warn: (m) => warnings.push(m),
    })();

  beforeEach(() => {
    token = 'tok-a';
    statuses = [];
    syncCalls = [];
    warnings = [];
    nextSync = async () => 'ok';
  });

  it("records the signed-in user's identity status", async () => {
    await run();

    expect(syncCalls).toEqual(['tok-a']);
    expect(statuses).toEqual(['ok']);
    expect(warnings).toEqual([]);
  });

  it('records and warns on a mismatch', async () => {
    nextSync = async () => 'mismatch';

    await run();

    expect(statuses).toEqual(['mismatch']);
    expect(warnings).toHaveLength(1);
  });

  it('drops a result that lands after the user changed', async () => {
    let resolve: (s: IdentityStatus) => void = () => undefined;
    nextSync = () => new Promise((r) => (resolve = r));

    const running = run();
    token = 'tok-b';
    resolve('mismatch');
    await running;

    expect(statuses).toEqual([]);
  });

  it('swallows a failed sync and records nothing', async () => {
    nextSync = async () => {
      throw new Error('offline');
    };

    await expect(run()).resolves.toBeUndefined();
    expect(statuses).toEqual([]);
  });

  it('does nothing without a token', async () => {
    token = null;

    await run();

    expect(syncCalls).toEqual([]);
  });
});
