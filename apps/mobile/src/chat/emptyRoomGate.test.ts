import { describe, it, expect } from 'bun:test';
import { showEmptyRoom } from './emptyRoomGate';

describe('showEmptyRoom', () => {
  it('shows for a loaded, connected room with no messages', () => {
    expect(showEmptyRoom({ loaded: true, messageCount: 0, wsStatus: 'connected' })).toBe(true);
  });
  it('hides while local history is still loading (re-entry into a non-empty room)', () => {
    expect(showEmptyRoom({ loaded: false, messageCount: 0, wsStatus: 'connected' })).toBe(false);
  });
  it('hides once there are messages', () => {
    expect(showEmptyRoom({ loaded: true, messageCount: 1, wsStatus: 'connected' })).toBe(false);
  });
  it('hides while not connected: an empty local copy may not be the whole room', () => {
    expect(showEmptyRoom({ loaded: true, messageCount: 0, wsStatus: 'connecting' })).toBe(false);
    expect(showEmptyRoom({ loaded: true, messageCount: 0, wsStatus: 'disconnected' })).toBe(false);
  });
});
