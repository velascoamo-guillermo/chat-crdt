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
import * as decoding from 'lib0/decoding';
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
  let roomKeys: { onEpochAdvanced: jest.Mock; onGrantsStored: jest.Mock; hasPendingFor: jest.Mock };

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
    roomKeys = { onEpochAdvanced: jest.fn(), onGrantsStored: jest.fn(), hasPendingFor: jest.fn() };

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
    const ENVELOPE =
      'E2E1{"v":1,"keyId":1,"nonce":"q-9_zXk0aB2cD3eF4gH5iJ6kL7mN8oP9","ciphertext":"Zm9v-YmFy_YmF6LXF1eC1xdXV4LWNvcmdl"}';
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

    it('keeps an epoch claimed while the room is still loading (read raced the claim)', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      rooms.isMember.mockResolvedValue(true);
      gateway.onModuleInit();
      const listener = roomKeys.onEpochAdvanced.mock.calls[0][0] as (roomId: string, keyId: number) => void;
      // The DB read returns the pre-claim epoch; the claim commits (and its
      // event fires) before the load finishes and dbId is known.
      prisma.room.findUnique.mockImplementation(async () => {
        listener('db-a', 1);
        return { id: 'db-a', name: 'team-a', currentKeyId: 0, yjsState: null };
      });

      await gateway.handleConnection(new FakeSocket() as any, fakeReq({ room: 'team-a', token: 'ok' }));

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

    it('never gates the default lobby, even if it somehow carries an epoch', () => {
      const room = seedRoom('default', 1);
      const sender = new FakeSocket();
      room.clients.add(sender as any);

      (gateway as any).handleMessage(
        sender,
        room,
        updateFrame((d) => d.getArray('messages').push([msg('m1', 'hello lobby')])),
      );

      expect(room.doc.getArray('messages').length).toBe(1);
      expect(metrics.incE2eeRejectedUpdates).not.toHaveBeenCalled();
    });

    describe('typed frames (client recovery + live gating)', () => {
      const E2EE_REJECTED = 20;
      const ROOM_EPOCH = 21;

      function framesOfType(socket: FakeSocket, type: number): decoding.Decoder[] {
        return socket.sent
          .map((bytes) => decoding.createDecoder(new Uint8Array(bytes)))
          .filter((d) => decoding.readVarUint(d) === type);
      }

      function readRejection(d: decoding.Decoder) {
        const keyId = decoding.readVarUint(d);
        const count = decoding.readVarUint(d);
        const ids = Array.from({ length: count }, () => decoding.readVarString(d));
        return { keyId, ids };
      }

      it('tells the rejected sender which messages were refused, then asks it to resync', () => {
        const room = seedRoom('team-a', 2);
        const sender = new FakeSocket();
        room.clients.add(sender as any);
        jest.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);

        (gateway as any).handleMessage(
          sender,
          room,
          updateFrame((d) => d.getArray('messages').push([msg('m1', ENVELOPE), msg('m2', SECRET)])),
        );

        const rejections = framesOfType(sender, E2EE_REJECTED);
        expect(rejections).toHaveLength(1);
        expect(readRejection(rejections[0])).toEqual({ keyId: 2, ids: ['m2'] });
        // The frame names ids only — it must never echo the plaintext back.
        for (const bytes of sender.sent) expect(Buffer.from(bytes).toString('utf8')).not.toContain(SECRET);
        // Followed by a sync step1, so the client answers with a fresh step2.
        const last = decoding.createDecoder(new Uint8Array(sender.sent.at(-1)!));
        expect(decoding.readVarUint(last)).toBe(0); // MSG_SYNC
        expect(decoding.readVarUint(last)).toBe(0); // step1
      });

      it('accepts the resync once the client retracted its plaintext, so its queued envelopes land', () => {
        const room = seedRoom('team-a', 1);
        const sender = new FakeSocket();
        room.clients.add(sender as any);
        jest.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);
        const clientDoc = new Y.Doc({ gc: true });
        const messages = clientDoc.getArray('messages');
        messages.push([msg('m1', SECRET), msg('m2', ENVELOPE)]);
        const stepFrame = () => {
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, 0);
          syncProtocol.writeSyncStep2(enc, clientDoc);
          return Buffer.from(encoding.toUint8Array(enc));
        };
        (gateway as any).handleMessage(sender, room, stepFrame());
        expect(room.doc.getArray('messages').length).toBe(0);

        messages.delete(0, 1); // what the client does on E2EE_REJECTED
        (gateway as any).handleMessage(sender, room, stepFrame());

        expect(room.doc.getArray('messages').toArray()).toEqual([msg('m2', ENVELOPE)]);
      });

      it('sends the current epoch to a client joining an E2EE room', async () => {
        jwt.verify.mockReturnValue({ sub: 'user-1' });
        rooms.isMember.mockResolvedValue(true);
        prisma.room.findUnique.mockResolvedValue({ id: 'db-a', name: 'team-a', currentKeyId: 3, yjsState: null });
        const client = new FakeSocket();

        await gateway.handleConnection(client as any, fakeReq({ room: 'team-a', token: 'ok' }));

        const epochs = framesOfType(client, ROOM_EPOCH);
        expect(epochs).toHaveLength(1);
        expect(decoding.readVarUint(epochs[0])).toBe(3);
      });

      it('sends no epoch frame to a client joining a plaintext room', async () => {
        jwt.verify.mockReturnValue({ sub: 'user-1' });
        rooms.isMember.mockResolvedValue(true);
        prisma.room.findUnique.mockResolvedValue({ id: 'db-b', name: 'team-b', currentKeyId: 0, yjsState: null });
        const client = new FakeSocket();

        await gateway.handleConnection(client as any, fakeReq({ room: 'team-b', token: 'ok' }));

        expect(framesOfType(client, ROOM_EPOCH)).toHaveLength(0);
      });

      it('pushes a newly claimed epoch to every client already in the room', () => {
        const room = seedRoom('team-a', 0);
        (room as any).dbId = 'db-a';
        const inRoom = new FakeSocket();
        room.clients.add(inRoom as any);
        gateway.onModuleInit();
        const listener = roomKeys.onEpochAdvanced.mock.calls[0][0] as (roomId: string, keyId: number) => void;

        listener('db-a', 1);

        const epochs = framesOfType(inRoom, ROOM_EPOCH);
        expect(epochs).toHaveLength(1);
        expect(decoding.readVarUint(epochs[0])).toBe(1);
      });

      it('pushes an epoch claimed on another instance (Redis) to local clients', () => {
        const room = seedRoom('team-a', 0);
        (room as any).dbId = 'db-a';
        const inRoom = new FakeSocket();
        room.clients.add(inRoom as any);
        gateway.onModuleInit();
        const onPmessage = sub.on.mock.calls.find(([event]) => event === 'pmessage')![1] as (
          pattern: string,
          channel: string,
          message: string,
        ) => void;

        onPmessage('room:epoch:*', 'room:epoch:db-a', JSON.stringify({ origin: 'other-instance', keyId: 2 }));

        expect(framesOfType(inRoom, ROOM_EPOCH)).toHaveLength(1);
      });

      it('does not re-push an epoch the room already has', () => {
        const room = seedRoom('team-a', 2);
        (room as any).dbId = 'db-a';
        const inRoom = new FakeSocket();
        room.clients.add(inRoom as any);
        gateway.onModuleInit();
        const listener = roomKeys.onEpochAdvanced.mock.calls[0][0] as (roomId: string, keyId: number) => void;

        listener('db-a', 2);

        expect(framesOfType(inRoom, ROOM_EPOCH)).toHaveLength(0);
      });

      describe('repeated identical rejection (loop guard)', () => {
        afterEach(() => jest.useRealTimers());

        function rejectSame(room: RoomState, sender: FakeSocket, frame: Buffer) {
          (gateway as any).handleMessage(sender, room, frame);
        }
        const step1Count = (socket: FakeSocket) =>
          socket.sent.filter((bytes) => {
            const d = decoding.createDecoder(new Uint8Array(bytes));
            return decoding.readVarUint(d) === 0 && decoding.readVarUint(d) === 0;
          }).length;

        it('answers a first rejection with an immediate step1, then backs off for the same update', () => {
          jest.useFakeTimers();
          const room = seedRoom('team-a', 1);
          const sender = new FakeSocket();
          room.clients.add(sender as any);
          jest.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);
          const frame = updateFrame((d) => d.getArray('messages').push([msg('m1', SECRET)]));

          rejectSame(room, sender, frame);
          expect(step1Count(sender)).toBe(1);

          rejectSame(room, sender, frame);
          rejectSame(room, sender, frame);
          expect(step1Count(sender)).toBe(1); // no immediate re-ask

          jest.advanceTimersByTime(30_000);
          expect(step1Count(sender)).toBe(2); // one delayed re-ask, not one per rejection
          expect(framesOfType(sender, E2EE_REJECTED)).toHaveLength(3);
        });

        it('a different refused update is answered right away', () => {
          jest.useFakeTimers();
          const room = seedRoom('team-a', 1);
          const sender = new FakeSocket();
          room.clients.add(sender as any);
          jest.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);

          rejectSame(room, sender, updateFrame((d) => d.getArray('messages').push([msg('m1', SECRET)])));
          rejectSame(room, sender, updateFrame((d) => d.getArray('messages').push([msg('m2', 'other')])));

          expect(step1Count(sender)).toBe(2);
        });

        it('never re-asks a client that has gone away', () => {
          jest.useFakeTimers();
          const room = seedRoom('team-a', 1);
          const sender = new FakeSocket();
          room.clients.add(sender as any);
          jest.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);
          const frame = updateFrame((d) => d.getArray('messages').push([msg('m1', SECRET)]));
          rejectSame(room, sender, frame);
          rejectSame(room, sender, frame);

          sender.readyState = 3; // CLOSED
          jest.advanceTimersByTime(30_000);

          expect(step1Count(sender)).toBe(1);
        });
      });

      it('survives a failed epoch publish to Redis', async () => {
        pub.publish.mockRejectedValueOnce(new Error('redis down'));
        const warn = jest.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);
        gateway.onModuleInit();
        const listener = roomKeys.onEpochAdvanced.mock.calls[0][0] as (roomId: string, keyId: number) => void;

        listener('db-a', 1);
        await new Promise((r) => setImmediate(r));

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('epoch'));
      });
    });
  });

  describe('live key grants (T16)', () => {
    const KEY_REQUEST = 22;
    const KEY_GRANTED = 23;

    function typesSent(socket: FakeSocket): number[] {
      return socket.sent.map((bytes) => decoding.readVarUint(decoding.createDecoder(new Uint8Array(bytes))));
    }

    function frame(type: number): Buffer {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, type);
      return Buffer.from(encoding.toUint8Array(enc));
    }

    const flush = () => new Promise((r) => setImmediate(r));

    /** Connects one socket per user to `roomName` (an E2EE room at `keyId`). */
    async function connect(roomName: string, keyId: number, users: string[]): Promise<FakeSocket[]> {
      rooms.isMember.mockResolvedValue(true);
      prisma.room.findUnique.mockResolvedValue({ id: `db-${roomName}`, name: roomName, currentKeyId: keyId, yjsState: null });
      const sockets: FakeSocket[] = [];
      for (const user of users) {
        jwt.verify.mockReturnValueOnce({ sub: user });
        const socket = new FakeSocket();
        await gateway.handleConnection(socket as any, fakeReq({ room: roomName, token: 'ok' }));
        socket.sent.length = 0;
        sockets.push(socket);
      }
      return sockets;
    }

    function onPmessage() {
      return sub.on.mock.calls.find(([event]) => event === 'pmessage')![1] as (
        pattern: string,
        channel: string,
        message: string,
      ) => void;
    }

    it('relays a pending member\'s key request to the other members\' sockets only, and to other instances', async () => {
      gateway.onModuleInit();
      const [holder, gated, gatedOtherDevice] = await connect('team-a', 1, ['user-1', 'user-2', 'user-2']);
      roomKeys.hasPendingFor.mockResolvedValue(true);

      gated.emit('message', frame(KEY_REQUEST));
      await flush();

      expect(roomKeys.hasPendingFor).toHaveBeenCalledWith('db-team-a', 'user-2');
      expect(typesSent(holder)).toEqual([KEY_REQUEST]);
      // The frame is the type alone: no ids, no key material.
      expect(holder.sent[0].byteLength).toBe(1);
      expect(typesSent(gated)).toEqual([]);
      expect(typesSent(gatedOtherDevice)).toEqual([]);
      expect(pub.publish).toHaveBeenCalledWith('room:keyreq:db-team-a', expect.stringContaining('"userId":"user-2"'));
    });

    it('drops a key request from a member who has nothing pending', async () => {
      gateway.onModuleInit();
      const [holder, requester] = await connect('team-a', 1, ['user-1', 'user-2']);
      roomKeys.hasPendingFor.mockResolvedValue(false);

      requester.emit('message', frame(KEY_REQUEST));
      await flush();

      expect(typesSent(holder)).toEqual([]);
      expect(pub.publish).not.toHaveBeenCalledWith(expect.stringMatching(/^room:keyreq:/), expect.anything());
    });

    it('ignores key requests in a plaintext room', async () => {
      gateway.onModuleInit();
      const [holder, requester] = await connect('team-b', 0, ['user-1', 'user-2']);

      requester.emit('message', frame(KEY_REQUEST));
      await flush();

      expect(roomKeys.hasPendingFor).not.toHaveBeenCalled();
      expect(typesSent(holder)).toEqual([]);
    });

    it('relays at most one key request per socket per second', async () => {
      gateway.onModuleInit();
      const [holder, gated] = await connect('team-a', 1, ['user-1', 'user-2']);
      roomKeys.hasPendingFor.mockResolvedValue(true);

      gated.emit('message', frame(KEY_REQUEST));
      gated.emit('message', frame(KEY_REQUEST));
      await flush();

      expect(roomKeys.hasPendingFor).toHaveBeenCalledTimes(1);
      expect(typesSent(holder)).toEqual([KEY_REQUEST]);
    });

    it('relays a key request from another instance (Redis) to local sockets of other users', async () => {
      gateway.onModuleInit();
      const [holder, gated] = await connect('team-a', 1, ['user-1', 'user-2']);

      onPmessage()('room:keyreq:*', 'room:keyreq:db-team-a', JSON.stringify({ origin: 'other', userId: 'user-2' }));

      expect(typesSent(holder)).toEqual([KEY_REQUEST]);
      expect(typesSent(gated)).toEqual([]);
    });

    it('tells only the recipients\' sockets that their grant landed, and other instances', async () => {
      gateway.onModuleInit();
      const [holder, gated, bystander] = await connect('team-a', 1, ['user-1', 'user-2', 'user-3']);
      const listener = roomKeys.onGrantsStored.mock.calls[0][0] as (roomId: string, userIds: string[]) => void;

      listener('db-team-a', ['user-2']);

      expect(typesSent(gated)).toEqual([KEY_GRANTED]);
      expect(gated.sent[0].byteLength).toBe(1);
      expect(typesSent(holder)).toEqual([]);
      expect(typesSent(bystander)).toEqual([]);
      expect(pub.publish).toHaveBeenCalledWith('room:keygrant:db-team-a', expect.stringContaining('"userIds":["user-2"]'));
    });

    it('delivers a grant notice from another instance (Redis) to the recipient only', async () => {
      gateway.onModuleInit();
      const [holder, gated] = await connect('team-a', 1, ['user-1', 'user-2']);

      onPmessage()('room:keygrant:*', 'room:keygrant:db-team-a', JSON.stringify({ origin: 'other', userIds: ['user-2'] }));

      expect(typesSent(gated)).toEqual([KEY_GRANTED]);
      expect(typesSent(holder)).toEqual([]);
    });

    it('does not deliver a grant notice to the same user in a different room', async () => {
      gateway.onModuleInit();
      const [elsewhere] = await connect('team-c', 1, ['user-2']);
      const listener = roomKeys.onGrantsStored.mock.calls[0][0] as (roomId: string, userIds: string[]) => void;

      listener('db-team-a', ['user-2']);

      expect(typesSent(elsewhere)).toEqual([]);
    });
  });
});
