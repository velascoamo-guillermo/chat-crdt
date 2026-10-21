import { describe, it, expect, beforeEach, mock } from 'bun:test';

// rooms.store pulls SecureStore (native) through these two modules; swap them
// for in-memory stand-ins so the store's own wiring can run under bun.
const sticky = new Map<string, string>();
mock.module('../crypto/secureStoreBackend', () => ({
  secureStoreBackend: {
    getItem: async (k: string) => sticky.get(k) ?? null,
    setItem: async (k: string, v: string) => void sticky.set(k, v),
    removeItem: async (k: string) => void sticky.delete(k),
  },
}));
mock.module('./auth.store', () => ({
  useAuthStore: { getState: () => ({ token: 'test-token' }) },
}));

const { useRoomsStore } = await import('./rooms.store');

type Room = { id: string; name: string; role: string; currentKeyId: number };
const room = (name: string, currentKeyId: number): Room => ({ id: name, name, role: 'member', currentKeyId });

/** Each fetch call gets its own manually-resolved response. */
const pending: ((rooms: Room[]) => void)[] = [];
globalThis.fetch = (() =>
  new Promise((resolve) => {
    pending.push((rooms) => resolve(new Response(JSON.stringify(rooms), { status: 200 })));
  })) as unknown as typeof fetch;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('rooms.store T10 wiring', () => {
  beforeEach(() => {
    pending.length = 0;
    sticky.clear();
    useRoomsStore.setState({ rooms: [], refreshByRoom: {}, everE2eeByRoom: {}, isLoading: false, error: null });
  });

  it('noteRoomEpoch bumps the cached summary, settles the refresh as E2EE and persists the sticky flag', async () => {
    useRoomsStore.setState({ rooms: [room('team-a', 0)] });

    useRoomsStore.getState().noteRoomEpoch('team-a', 2);
    await flush();

    const s = useRoomsStore.getState();
    expect(s.rooms[0].currentKeyId).toBe(2);
    expect(s.refreshByRoom['team-a']).toEqual({ status: 'ok', currentKeyId: 2 });
    expect(s.everE2eeByRoom['team-a']).toBe(true);
    expect(sticky.get('e2ee-ever.team-a')).toBe('1');
  });

  it('noteRoomEpoch never lowers an epoch', () => {
    useRoomsStore.setState({ rooms: [room('team-a', 3)] });
    useRoomsStore.getState().noteRoomEpoch('team-a', 1);
    expect(useRoomsStore.getState().rooms[0].currentKeyId).toBe(3);
  });

  it('stopRoomRefresh forgets the room state (re-entry reads unknown)', async () => {
    const run = useRoomsStore.getState().refreshRoom('team-a');
    await flush();
    pending[0]([room('team-a', 0)]);
    await run;
    expect(useRoomsStore.getState().refreshByRoom['team-a']).toEqual({ status: 'ok', currentKeyId: 0 });

    useRoomsStore.getState().stopRoomRefresh('team-a');

    expect(useRoomsStore.getState().refreshByRoom['team-a']).toBeUndefined();
  });

  it('an older rooms response settling last does not overwrite a newer one', async () => {
    const older = useRoomsStore.getState().fetchRooms();
    await flush();
    const newer = useRoomsStore.getState().refreshRoom('team-a');
    await flush();

    pending[1]([room('team-a', 2)]); // newer request settles first
    await newer;
    pending[0]([room('team-a', 0)]); // stale list arrives late
    await older;

    expect(useRoomsStore.getState().rooms[0].currentKeyId).toBe(2);
    useRoomsStore.getState().stopRoomRefresh('team-a');
  });
});
