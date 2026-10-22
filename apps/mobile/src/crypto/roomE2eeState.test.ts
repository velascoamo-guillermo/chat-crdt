import { describe, it, expect } from 'bun:test';
import { resolveRoomE2eeState } from './roomE2eeState';

// T10: the cached rooms-list summary can be stale (fetched before an admin
// enabled E2EE). Only an authoritative per-entry refresh may say "plaintext";
// until then the room's E2EE state is unknown, which must fail closed.
describe('resolveRoomE2eeState', () => {
  it('stale cached 0 + fetched N -> e2ee', () => {
    expect(
      resolveRoomE2eeState({ cachedKeyId: 0, refresh: { status: 'ok', currentKeyId: 3 }, everE2ee: false })
    ).toBe('e2ee');
  });

  it('cached 0 while the refresh is pending -> unknown (not plaintext)', () => {
    expect(resolveRoomE2eeState({ cachedKeyId: 0, refresh: { status: 'pending' }, everE2ee: false })).toBe(
      'unknown'
    );
  });

  it('no refresh started yet is the same as pending -> unknown', () => {
    expect(resolveRoomE2eeState({ cachedKeyId: 0, refresh: undefined, everE2ee: false })).toBe('unknown');
  });

  it('cached N while pending -> e2ee (a room never goes back to plaintext)', () => {
    expect(resolveRoomE2eeState({ cachedKeyId: 2, refresh: { status: 'pending' }, everE2ee: false })).toBe(
      'e2ee'
    );
  });

  it('sticky ever-E2EE while pending -> e2ee', () => {
    expect(resolveRoomE2eeState({ cachedKeyId: 0, refresh: { status: 'pending' }, everE2ee: true })).toBe(
      'e2ee'
    );
  });

  it('confirmed plaintext by the server -> plaintext', () => {
    expect(
      resolveRoomE2eeState({ cachedKeyId: 0, refresh: { status: 'ok', currentKeyId: 0 }, everE2ee: false })
    ).toBe('plaintext');
  });

  it('server says 0 but this device saw the room E2EE before -> e2ee (no downgrade)', () => {
    expect(
      resolveRoomE2eeState({ cachedKeyId: 0, refresh: { status: 'ok', currentKeyId: 0 }, everE2ee: true })
    ).toBe('e2ee');
  });

  describe('offline (no network and no sync socket)', () => {
    it('cached E2EE stays e2ee', () => {
      expect(resolveRoomE2eeState({ cachedKeyId: 1, refresh: { status: 'offline' }, everE2ee: false })).toBe(
        'e2ee'
      );
    });

    it('sticky ever-E2EE flag keeps a stale cached 0 at e2ee', () => {
      expect(resolveRoomE2eeState({ cachedKeyId: 0, refresh: { status: 'offline' }, everE2ee: true })).toBe(
        'e2ee'
      );
    });

    it('a room never seen as E2EE may stay plaintext offline', () => {
      expect(resolveRoomE2eeState({ cachedKeyId: 0, refresh: { status: 'offline' }, everE2ee: false })).toBe(
        'plaintext'
      );
    });
  });

  // T10 review I2: an HTTP error (5xx, 401...), a network blip while the
  // socket is up, or the room missing from the list says nothing about the
  // room's E2EE state, so it must not unlock plaintext.
  describe('refresh error (server reachable or socket up)', () => {
    it('never-E2EE room with cached 0 stays unknown (gated)', () => {
      expect(resolveRoomE2eeState({ cachedKeyId: 0, refresh: { status: 'error' }, everE2ee: false })).toBe(
        'unknown'
      );
    });

    it('cached E2EE stays e2ee', () => {
      expect(resolveRoomE2eeState({ cachedKeyId: 2, refresh: { status: 'error' }, everE2ee: false })).toBe(
        'e2ee'
      );
    });
  });
});
