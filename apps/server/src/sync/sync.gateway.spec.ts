import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { SyncGateway } from './sync.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { RoomKeysService } from '../rooms/room-keys.service';
import { MetricsService } from '../metrics/metrics.service';
import { FakeSocket, fakeReq, redisMock } from './__test__/fakes';
import * as Y from 'yjs';
import { RoomState } from './room-state';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';

function metricsMock() {
  return {
    incWsConnections: jest.fn(),
    decWsConnections: jest.fn(),
    incRoomsLoaded: jest.fn(),
    decRoomsLoaded: jest.fn(),
    incMessages: jest.fn(),
    incFanoutBytes: jest.fn(),
    observePersistDurationSeconds: jest.fn(),
    setYjsStateBytes: jest.fn(),
    removeYjsStateBytes: jest.fn(),
    incE2eeRejectedUpdates: jest.fn(),
  };
}

describe('SyncGateway', () => {
  let gateway: SyncGateway;
  let jwt: { verify: jest.Mock };
  let rooms: { isMember: jest.Mock };
  let prisma: { room: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock } };
  let pub: ReturnType<typeof redisMock>;
  let sub: ReturnType<typeof redisMock>;
  let metrics: ReturnType<typeof metricsMock>;
  let roomKeys: { onEpochAdvanced: jest.Mock };

  beforeEach(async () => {
    jwt = { verify: jest.fn() };
    rooms = { isMember: jest.fn() };
    prisma = {
      room: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    pub = redisMock();
    sub = redisMock();
    metrics = metricsMock();
    roomKeys = { onEpochAdvanced: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        SyncGateway,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: RoomsService, useValue: rooms },
        { provide: 'REDIS_PUB', useValue: pub },
        { provide: 'REDIS_SUB', useValue: sub },
        { provide: MetricsService, useValue: metrics },
        { provide: RoomKeysService, useValue: roomKeys },
      ],
    }).compile();

    gateway = module.get(SyncGateway);
  });

  afterEach(() => {
    // RoomState's Awareness schedules a setInterval (y-protocols, 3s tick).
    // Destroy any rooms the test created so that timer doesn't outlive the
    // test and fire after jest tears down modules.
    const rooms = (gateway as any).rooms as Map<string, { destroy(): void }>;
    rooms?.forEach(room => room.destroy());
    rooms?.clear();

    // schedulePersist debounces with a 5s setTimeout per room — clear any
    // pending ones so they don't fire after the test/module is torn down.
    const persistTimers = (gateway as any).persistTimers as Map<string, ReturnType<typeof setTimeout>>;
    persistTimers?.forEach(timer => clearTimeout(timer));
    persistTimers?.clear();
  });

  describe('handleConnection auth', () => {
    it('closes with 4001 when the token fails verification', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('bad token');
      });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ token: 'garbage' }));

      expect(client.lastCloseCode()).toBe(4001);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('closes with 4003 when a valid user is not a member of a non-default room', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      rooms.isMember.mockResolvedValue(false);

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'private-room', token: 'ok' }));

      expect(rooms.isMember).toHaveBeenCalledWith('private-room', 'user-1');
      expect(client.lastCloseCode()).toBe(4003);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('skips the membership check for the open "default" lobby', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));

      expect(rooms.isMember).not.toHaveBeenCalled();
      expect(client.send).toHaveBeenCalled(); // sync step1/step2 sent
    });
  });

  describe('handleConnection success', () => {
    it('sends sync step1 + step2 and tracks the client in the room', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));

      // step1 (state vector) + step2 (full snapshot) are two distinct sends
      expect(client.send.mock.calls.length).toBeGreaterThanOrEqual(2);

      const rooms = (gateway as any).rooms as Map<string, { clients: Set<unknown> }>;
      expect(rooms.get('default')!.clients.has(client)).toBe(true);

      const clientRoom = (gateway as any).clientRoom as WeakMap<object, string>;
      expect(clientRoom.get(client)).toBe('default');
    });

    it('upserts the room row on first load when no persisted state exists', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));

      expect(prisma.room.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: 'default' } }),
      );
    });

    it('marks the client alive on connect and resets alive on pong', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));

      expect((gateway as any).alive.get(client)).toBe(true);

      // Simulate a missed cycle, then a pong arriving.
      (gateway as any).alive.set(client, false);
      client.emit('pong');
      expect((gateway as any).alive.get(client)).toBe(true);
    });
  });

  describe('doc update fan-out', () => {
    function seedRoom(roomId: string): RoomState {
      const room = new RoomState(roomId);
      (gateway as any).rooms.set(roomId, room);
      (gateway as any).registerRoomUpdateHandler(room);
      return room;
    }

    it('fans a delta out to every local client except the origin, and publishes to Redis', () => {
      const room = seedRoom('default');
      const origin = new FakeSocket();
      const other = new FakeSocket();
      room.clients.add(origin as any);
      room.clients.add(other as any);

      // Mutate the doc with `origin` as the transaction origin.
      room.doc.transact(() => {
        room.doc.getArray('messages').push([{ id: 'm1', content: 'hi' }]);
      }, origin);

      expect(other.send).toHaveBeenCalledTimes(1); // received the delta
      expect(origin.send).not.toHaveBeenCalled();   // not echoed to sender
      expect(pub.publish).toHaveBeenCalledWith(
        'room:update:default',
        expect.any(String),
      );
    });

    it('does not re-publish updates that arrived from Redis', () => {
      const room = seedRoom('default');
      const local = new FakeSocket();
      room.clients.add(local as any);
      pub.publish.mockClear();

      // Build a delta from a separate source doc, then apply it as if from Redis.
      const source = new Y.Doc();
      source.getArray('messages').push([{ id: 'm2', content: 'from other instance' }]);
      const delta = Y.encodeStateAsUpdate(source);

      Y.applyUpdate(room.doc, delta, 'redis');

      expect(local.send).toHaveBeenCalledTimes(1); // fanned out locally
      expect(pub.publish).not.toHaveBeenCalled();  // not echoed back to Redis
    });
  });

  describe('handleDisconnect', () => {
    it('removes the client from the room and clears its awareness states', () => {
      // The room-empty branch schedules a 30s GC setTimeout; fake timers
      // keep it (and RoomState's Awareness 3s interval) from leaking.
      jest.useFakeTimers();

      const room = new RoomState('default');
      (gateway as any).rooms.set('default', room);

      const client = new FakeSocket();
      room.clients.add(client as any);
      (gateway as any).clientRoom.set(client, 'default');
      (gateway as any).awarenessIds.set(client, new Set([42]));
      room.awareness.states.set(42, { user: 'someone' });

      gateway.handleDisconnect(client as any);

      expect(room.clients.has(client as any)).toBe(false);
      expect(room.awareness.getStates().has(42)).toBe(false);
      expect((gateway as any).awarenessIds.has(client)).toBe(false);

      jest.useRealTimers();
    });

    it('is a no-op for a socket that never joined a room', () => {
      const client = new FakeSocket();
      expect(() => gateway.handleDisconnect(client as any)).not.toThrow();
    });
  });

  describe('sweepHeartbeats', () => {
    function withClients(...clients: FakeSocket[]) {
      (gateway as any).server = { clients: new Set(clients) };
    }

    it('terminates a client that missed the previous pong', () => {
      const dead = new FakeSocket();
      withClients(dead);
      (gateway as any).alive.set(dead, false); // missed last cycle

      gateway.sweepHeartbeats();

      expect(dead.terminate).toHaveBeenCalledTimes(1);
      expect(dead.ping).not.toHaveBeenCalled();
    });

    it('pings a live client and arms it for the next cycle', () => {
      const live = new FakeSocket();
      withClients(live);
      (gateway as any).alive.set(live, true);

      gateway.sweepHeartbeats();

      expect(live.ping).toHaveBeenCalledTimes(1);
      expect(live.terminate).not.toHaveBeenCalled();
      expect((gateway as any).alive.get(live)).toBe(false); // re-armed
    });
  });

  describe('heartbeat lifecycle', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('runs the sweep on the interval after init and stops after destroy', () => {
      const sweep = jest.spyOn(gateway, 'sweepHeartbeats').mockImplementation(() => {});
      const fakeServer = { clients: new Set() };

      gateway.afterInit(fakeServer as any);
      jest.advanceTimersByTime(30_000);
      expect(sweep).toHaveBeenCalledTimes(1);

      gateway.onModuleDestroy();
      jest.advanceTimersByTime(60_000);
      expect(sweep).toHaveBeenCalledTimes(1); // no further ticks after destroy

      sweep.mockRestore();
    });
  });

  describe('yjsState size monitoring', () => {
    it('warns when the persisted blob crosses the retention threshold', () => {
      const warn = jest.spyOn((gateway as any).logger, 'warn');
      (gateway as any).warnIfStateLarge('default', 2_000_000);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('default'));
    });

    it('stays silent below the threshold', () => {
      const warn = jest.spyOn((gateway as any).logger, 'warn');
      warn.mockClear();
      (gateway as any).warnIfStateLarge('default', 1_000);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('RoomState GC', () => {
    it('constructs the room doc with garbage collection enabled', () => {
      const room = new RoomState('default');
      expect(room.doc.gc).toBe(true);
    });
  });

  describe('metrics emission', () => {
    it('increments ws_connections on connect and decrements on disconnect', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));
      expect(metrics.incWsConnections).toHaveBeenCalledTimes(1);

      gateway.handleDisconnect(client as any);
      expect(metrics.decWsConnections).toHaveBeenCalledTimes(1);
    });

    it('increments rooms_loaded when a room is first created', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      rooms.isMember.mockResolvedValue(true);

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'fresh-room', token: 'ok' }));

      expect(metrics.incRoomsLoaded).toHaveBeenCalledTimes(1);
    });

    it('increments messages_total labeled "sync" on a sync message', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));
      metrics.incMessages.mockClear();

      const room = (gateway as any).rooms.get('default') as RoomState;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // MSG_SYNC
      syncProtocol.writeSyncStep1(encoder, room.doc);
      const data = Buffer.from(encoding.toUint8Array(encoder));

      (gateway as any).handleMessage(client, room, data);

      expect(metrics.incMessages).toHaveBeenCalledWith('sync');
    });

    it('increments messages_total labeled "awareness" on an awareness message', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));
      metrics.incMessages.mockClear();

      const room = (gateway as any).rooms.get('default') as RoomState;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 1); // MSG_AWARENESS
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, [room.awareness.clientID]),
      );
      const data = Buffer.from(encoding.toUint8Array(enc));

      (gateway as any).handleMessage(client, room, data);

      expect(metrics.incMessages).toHaveBeenCalledWith('awareness');
    });

    it('records fanout_bytes_total, labeled "doc", when a doc update is published to Redis', () => {
      const room = new RoomState('default');
      (gateway as any).rooms.set('default', room);
      (gateway as any).registerRoomUpdateHandler(room);

      room.doc.transact(() => {
        room.doc.getArray('messages').push([{ id: 'm1', content: 'hi' }]);
      });

      expect(metrics.incFanoutBytes).toHaveBeenCalledTimes(1);
      expect(metrics.incFanoutBytes).toHaveBeenCalledWith(expect.any(Number), 'doc');
    });

    it('records fanout_bytes_total, labeled "awareness", when an awareness update is published to Redis', () => {
      const room = new RoomState('default');
      (gateway as any).rooms.set('default', room);
      (gateway as any).registerRoomAwarenessHandler(room);

      room.awareness.setLocalState({ user: 'someone' });

      expect(metrics.incFanoutBytes).toHaveBeenCalledWith(expect.any(Number), 'awareness');
    });

    it('does not increment fanout_bytes_total for a doc update that arrived from Redis', () => {
      const room = new RoomState('default');
      (gateway as any).rooms.set('default', room);
      (gateway as any).registerRoomUpdateHandler(room);

      const source = new Y.Doc();
      source.getArray('messages').push([{ id: 'm2', content: 'from other instance' }]);
      const delta = Y.encodeStateAsUpdate(source);

      Y.applyUpdate(room.doc, delta, 'redis');

      expect(metrics.incFanoutBytes).not.toHaveBeenCalled();
    });

    it('observes persist_duration_seconds and sets yjs_state_bytes on persist', async () => {
      const room = new RoomState('default');
      room.doc.getArray('messages').push([{ id: 'm1', content: 'hi' }]);

      await (gateway as any).persistRoomState(room);
      room.destroy();

      expect(metrics.observePersistDurationSeconds).toHaveBeenCalledWith(expect.any(Number));
      expect(metrics.setYjsStateBytes).toHaveBeenCalledWith('default', expect.any(Number));
    });

    it('decrements rooms_loaded and removes the yjs_state_bytes series when an empty room is garbage collected', () => {
      jest.useFakeTimers();

      const room = new RoomState('default');
      (gateway as any).rooms.set('default', room);
      const client = new FakeSocket();
      room.clients.add(client as any);
      (gateway as any).clientRoom.set(client, 'default');

      gateway.handleDisconnect(client as any);
      jest.advanceTimersByTime(30_000);

      expect(metrics.decRoomsLoaded).toHaveBeenCalledTimes(1);
      expect(metrics.removeYjsStateBytes).toHaveBeenCalledWith('default');

      jest.useRealTimers();
    });

    it('decrements ws_connections even if the room was already garbage collected out from under the socket', () => {
      const client = new FakeSocket();
      (gateway as any).clientRoom.set(client, 'a-room-that-is-gone');
      // Deliberately no entry in `rooms` for 'a-room-that-is-gone' — simulates
      // the room having been GC'd between this client's last activity and
      // its disconnect event.

      gateway.handleDisconnect(client as any);

      expect(metrics.decWsConnections).toHaveBeenCalledTimes(1);
    });
  });

  describe('E2EE plaintext gate (T10)', () => {
    const ENVELOPE = 'E2E1{"v":1,"keyId":1,"nonce":"bm9uY2U=","ciphertext":"Y2lwaGVy"}';
    const SECRET = 'plaintext that must not leak';

    function msg(id: string, content: string) {
      return { id, roomId: 'team-a', userId: 'u1', username: 'bob', content, createdAt: 1 };
    }

    function seedRoom(roomId: string, currentKeyId: number): RoomState {
      const room = new RoomState(roomId);
      room.currentKeyId = currentKeyId;
      (gateway as any).rooms.set(roomId, room);
      (gateway as any).registerRoomUpdateHandler(room);
      return room;
    }

    /** A client's MSG_SYNC frame carrying the update for one mutation. */
    function updateFrame(mutate: (doc: Y.Doc) => void): Buffer {
      const clientDoc = new Y.Doc();
      let update: Uint8Array | null = null;
      clientDoc.on('update', (u: Uint8Array) => {
        update = u;
      });
      mutate(clientDoc);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0); // MSG_SYNC
      syncProtocol.writeUpdate(enc, update!);
      return Buffer.from(encoding.toUint8Array(enc));
    }

    function step2Frame(mutate: (doc: Y.Doc) => void): Buffer {
      const clientDoc = new Y.Doc();
      mutate(clientDoc);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0); // MSG_SYNC
      syncProtocol.writeSyncStep2(enc, clientDoc);
      return Buffer.from(encoding.toUint8Array(enc));
    }

    it('rejects a plaintext message update into an E2EE room: not applied, not broadcast, logged + counted', () => {
      const room = seedRoom('team-a', 1);
      const sender = new FakeSocket();
      const other = new FakeSocket();
      room.clients.add(sender as any);
      room.clients.add(other as any);
      const warn = jest.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);

      (gateway as any).handleMessage(
        sender,
        room,
        updateFrame((d) => d.getArray('messages').push([msg('m1', SECRET)])),
      );

      expect(room.doc.getArray('messages').length).toBe(0);
      expect(other.send).not.toHaveBeenCalled();
      expect(pub.publish).not.toHaveBeenCalled();
      expect(metrics.incE2eeRejectedUpdates).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('team-a'));
      // The rejection log must never echo message content.
      for (const [line] of warn.mock.calls) expect(String(line)).not.toContain(SECRET);
    });

    it('rejects a sync step2 carrying a plaintext message into an E2EE room', () => {
      const room = seedRoom('team-a', 1);
      const sender = new FakeSocket();
      room.clients.add(sender as any);
      jest.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);

      (gateway as any).handleMessage(
        sender,
        room,
        step2Frame((d) => d.getArray('messages').push([msg('m1', ENVELOPE), msg('m2', SECRET)])),
      );

      expect(room.doc.getArray('messages').length).toBe(0);
      expect(metrics.incE2eeRejectedUpdates).toHaveBeenCalledTimes(1);
    });

    it('accepts an enveloped message update into an E2EE room and broadcasts it', () => {
      const room = seedRoom('team-a', 1);
      const sender = new FakeSocket();
      const other = new FakeSocket();
      room.clients.add(sender as any);
      room.clients.add(other as any);

      (gateway as any).handleMessage(
        sender,
        room,
        updateFrame((d) => d.getArray('messages').push([msg('m1', ENVELOPE)])),
      );

      expect(room.doc.getArray('messages').length).toBe(1);
      expect(other.send).toHaveBeenCalledTimes(1);
      expect(metrics.incE2eeRejectedUpdates).not.toHaveBeenCalled();
    });

    it('leaves a plaintext room (currentKeyId 0) unaffected', () => {
      const room = seedRoom('team-b', 0);
      const sender = new FakeSocket();
      const other = new FakeSocket();
      room.clients.add(sender as any);
      room.clients.add(other as any);

      (gateway as any).handleMessage(
        sender,
        room,
        updateFrame((d) => d.getArray('messages').push([msg('m1', 'hello')])),
      );

      expect(room.doc.getArray('messages').length).toBe(1);
      expect(other.send).toHaveBeenCalledTimes(1);
      expect(metrics.incE2eeRejectedUpdates).not.toHaveBeenCalled();
    });

    it('still answers a sync step1 in an E2EE room', () => {
      const room = seedRoom('team-a', 1);
      const sender = new FakeSocket();
      room.clients.add(sender as any);

      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0); // MSG_SYNC
      syncProtocol.writeSyncStep1(enc, new Y.Doc());
      (gateway as any).handleMessage(sender, room, Buffer.from(encoding.toUint8Array(enc)));

      expect(sender.send).toHaveBeenCalledTimes(1); // step2 reply
    });

    it('loads the room epoch from the database when the room is first loaded', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      rooms.isMember.mockResolvedValue(true);
      prisma.room.findUnique.mockResolvedValue({ id: 'db-a', name: 'team-a', currentKeyId: 2, yjsState: null });

      await gateway.handleConnection(new FakeSocket() as any, fakeReq({ room: 'team-a', token: 'ok' }));

      const room = (gateway as any).rooms.get('team-a') as RoomState;
      expect(room.currentKeyId).toBe(2);
    });

    it('raises a loaded room to a newly claimed epoch and tells other instances via Redis', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      rooms.isMember.mockResolvedValue(true);
      prisma.room.findUnique.mockResolvedValue({ id: 'db-a', name: 'team-a', currentKeyId: 0, yjsState: null });
      gateway.onModuleInit();
      await gateway.handleConnection(new FakeSocket() as any, fakeReq({ room: 'team-a', token: 'ok' }));
      const listener = roomKeys.onEpochAdvanced.mock.calls[0][0] as (roomId: string, keyId: number) => void;

      listener('db-a', 1);

      const room = (gateway as any).rooms.get('team-a') as RoomState;
      expect(room.currentKeyId).toBe(1);
      expect(pub.publish).toHaveBeenCalledWith('room:epoch:db-a', expect.stringContaining('"keyId":1'));
    });

    it('raises a loaded room to an epoch claimed on another instance (Redis)', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      rooms.isMember.mockResolvedValue(true);
      prisma.room.findUnique.mockResolvedValue({ id: 'db-a', name: 'team-a', currentKeyId: 0, yjsState: null });
      gateway.onModuleInit();
      await gateway.handleConnection(new FakeSocket() as any, fakeReq({ room: 'team-a', token: 'ok' }));
      const onPmessage = sub.on.mock.calls.find(([event]) => event === 'pmessage')![1] as (
        pattern: string,
        channel: string,
        message: string,
      ) => void;

      onPmessage('room:epoch:*', 'room:epoch:db-a', JSON.stringify({ origin: 'other-instance', keyId: 1 }));

      const room = (gateway as any).rooms.get('team-a') as RoomState;
      expect(room.currentKeyId).toBe(1);
    });

    it('never lowers a room epoch', () => {
      const room = seedRoom('team-a', 3);
      (room as any).dbId = 'db-a';
      gateway.onModuleInit();
      const listener = roomKeys.onEpochAdvanced.mock.calls[0][0] as (roomId: string, keyId: number) => void;

      listener('db-a', 1);

      expect(room.currentKeyId).toBe(3);
    });
  });
});
