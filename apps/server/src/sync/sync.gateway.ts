import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Server, WebSocket, RawData } from 'ws';
import { IncomingMessage } from 'http';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type Redis from 'ioredis';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { RoomKeysService } from '../rooms/room-keys.service';
import { RoomState } from './room-state';
import { checkEnvelopedUpdate } from './e2ee-update-gate';
import { MetricsService } from '../metrics/metrics.service';
import { createHash, randomUUID } from 'crypto';
import { WsMsgType } from '@chat-crdt/shared';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MSG_E2EE_REJECTED = WsMsgType.E2EE_REJECTED;
const MSG_ROOM_EPOCH = WsMsgType.ROOM_EPOCH;
const MSG_KEY_REQUEST = WsMsgType.KEY_REQUEST;
const MSG_KEY_GRANTED = WsMsgType.KEY_GRANTED;
const ROOM_GC_DELAY_MS = 30_000;
const PERSIST_DEBOUNCE_MS = 5_000;

const UPDATE_CHANNEL_PREFIX = 'room:update:';
const AWARENESS_CHANNEL_PREFIX = 'room:awareness:';
const EPOCH_CHANNEL_PREFIX = 'room:epoch:'; // + Prisma Room.id
const KEY_REQUEST_CHANNEL_PREFIX = 'room:keyreq:'; // + Prisma Room.id
const KEY_GRANT_CHANNEL_PREFIX = 'room:keygrant:'; // + Prisma Room.id

// T16: a socket's key requests are relayed at most this often.
const KEY_REQUEST_MIN_INTERVAL_MS = 1_000;

// y-protocols/sync message types carrying a doc update (step1 only carries a
// state vector).
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

// DoS guards: reject oversized frames and clients that flood the socket.
const MAX_WS_MESSAGE_BYTES = 64 * 1024; // 64 KiB per frame
const RATE_LIMIT_WINDOW_MS = 1_000;
const RATE_LIMIT_MAX_MSGS = 60; // per client per window

const HEARTBEAT_INTERVAL_MS = 30_000;
const YJS_STATE_WARN_BYTES = 1_000_000; // 1 MB — ADR-009 compaction trigger

interface RedisPayload {
  origin: string;
  update: string; // base64 incremental update
}

interface EpochPayload {
  origin: string;
  keyId: number;
}

interface KeyRequestPayload {
  origin: string;
  userId: string; // the requester: their own sockets don't get the relay
}

interface KeyGrantPayload {
  origin: string;
  userIds: string[];
}

interface RejectionState {
  signature: string;
  repeats: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const REJECT_RESYNC_BASE_MS = 1_000;
const REJECT_RESYNC_MAX_MS = 30_000;

interface RateState {
  count: number;
  windowStart: number;
}

@WebSocketGateway({ path: '/sync' })
export class SyncGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(SyncGateway.name);
  private readonly instanceId = randomUUID();
  private readonly rooms = new Map<string, RoomState>();
  // Stores Promise<RoomState> during initialization to prevent race on concurrent first connections
  private readonly roomInitMap = new Map<string, Promise<RoomState>>();
  private readonly clientRoom = new WeakMap<WebSocket, string>();
  private readonly persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly clientRate = new WeakMap<WebSocket, RateState>();
  // T10: last refused update per client, so an identical re-send (a client
  // that can't repair its state) gets the step1 re-ask on backoff instead of
  // a tight reject/resync loop.
  private readonly lastRejection = new WeakMap<WebSocket, RejectionState>();
  // Awareness clientIDs announced by each socket, so we can clear them on disconnect.
  private readonly awarenessIds = new WeakMap<WebSocket, Set<number>>();
  // Liveness flag per socket: true on connect + on every pong. A sweep that
  // finds `false` evicts the socket (it missed the previous ping's pong).
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  // T10: highest epoch seen per Prisma Room.id from claim events, kept even
  // for rooms not (fully) loaded here — a claim can commit between a room's
  // DB read and its dbId being known, and loadRoomState takes the max with
  // this so that event isn't lost. One small entry per E2EE room.
  private readonly epochByDbId = new Map<string, number>();
  // T16: authenticated user per socket, to route key requests and grant
  // notices by user.
  private readonly clientUser = new WeakMap<WebSocket, string>();
  private readonly lastKeyRequestAt = new WeakMap<WebSocket, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly roomsService: RoomsService,
    @Inject('REDIS_PUB') private readonly pub: Redis,
    @Inject('REDIS_SUB') private readonly sub: Redis,
    private readonly metrics: MetricsService,
    private readonly roomKeys: RoomKeysService,
  ) {}

  onModuleInit() {
    this.sub.psubscribe(
      `${UPDATE_CHANNEL_PREFIX}*`,
      `${AWARENESS_CHANNEL_PREFIX}*`,
      `${EPOCH_CHANNEL_PREFIX}*`,
      `${KEY_REQUEST_CHANNEL_PREFIX}*`,
      `${KEY_GRANT_CHANNEL_PREFIX}*`,
    );
    this.sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const parsed: unknown = JSON.parse(message);

      // Skip messages this instance published — local clients already received them.
      if ((parsed as { origin?: unknown }).origin === this.instanceId) return;

      if (channel.startsWith(EPOCH_CHANNEL_PREFIX)) {
        this.raiseEpoch(channel.slice(EPOCH_CHANNEL_PREFIX.length), (parsed as EpochPayload).keyId);
        return;
      }
      if (channel.startsWith(KEY_REQUEST_CHANNEL_PREFIX)) {
        const { userId } = parsed as KeyRequestPayload;
        this.relayKeyRequest(channel.slice(KEY_REQUEST_CHANNEL_PREFIX.length), userId);
        return;
      }
      if (channel.startsWith(KEY_GRANT_CHANNEL_PREFIX)) {
        const { userIds } = parsed as KeyGrantPayload;
        this.notifyGrantRecipients(channel.slice(KEY_GRANT_CHANNEL_PREFIX.length), userIds);
        return;
      }

      const payload = parsed as RedisPayload;
      if (channel.startsWith(UPDATE_CHANNEL_PREFIX)) {
        const room = this.rooms.get(channel.slice(UPDATE_CHANNEL_PREFIX.length));
        if (!room) return;
        // Apply with origin 'redis'. The doc 'update' handler fans this out to
        // local clients and skips re-publishing it back to Redis.
        Y.applyUpdate(room.doc, Buffer.from(payload.update, 'base64'), 'redis');
      } else if (channel.startsWith(AWARENESS_CHANNEL_PREFIX)) {
        const room = this.rooms.get(channel.slice(AWARENESS_CHANNEL_PREFIX.length));
        if (!room) return;
        // Same pattern: the awareness 'update' handler fans out locally.
        awarenessProtocol.applyAwarenessUpdate(
          room.awareness,
          Buffer.from(payload.update, 'base64'),
          'redis',
        );
      }
    });

    // T10: an epoch claimed through this instance's REST API — apply it
    // locally, then tell the other instances.
    this.roomKeys.onEpochAdvanced((dbId, keyId) => {
      this.raiseEpoch(dbId, keyId);
      const payload: EpochPayload = { origin: this.instanceId, keyId };
      // Pub/sub is at-most-once: a lost epoch leaves other instances' already
      // loaded copies of this room ungated until they reload it (see raiseEpoch).
      this.pub
        .publish(`${EPOCH_CHANNEL_PREFIX}${dbId}`, JSON.stringify(payload))
        .catch((err: Error) => this.logger.warn(`Failed to publish room epoch: ${err.message}`));
    });

    // T16: grants stored through this instance's REST API — tell the
    // recipients' sockets here, then on the other instances.
    this.roomKeys.onGrantsStored((dbId, userIds) => {
      this.notifyGrantRecipients(dbId, userIds);
      const payload: KeyGrantPayload = { origin: this.instanceId, userIds };
      this.pub
        .publish(`${KEY_GRANT_CHANNEL_PREFIX}${dbId}`, JSON.stringify(payload))
        .catch((err: Error) => this.logger.warn(`Failed to publish key grant notice: ${err.message}`));
    });
  }

  /**
   * T16: asks the room's other members' sockets on this instance to serve
   * pending grants (first-responder, ADR-010). The requester's own sockets
   * are skipped: they hold nothing to serve. Type-only frame, no ids.
   */
  private relayKeyRequest(dbId: string, requesterId: string): void {
    if (typeof requesterId !== 'string') return;
    const frame = encodeTypeOnly(MSG_KEY_REQUEST);
    for (const room of this.rooms.values()) {
      if (room.dbId !== dbId) continue;
      for (const client of room.clients) {
        if (this.clientUser.get(client) !== requesterId && client.readyState === WebSocket.OPEN) {
          client.send(frame);
        }
      }
    }
  }

  /** T16: tells only the recipients' sockets in that room that their grant landed. */
  private notifyGrantRecipients(dbId: string, userIds: string[]): void {
    if (!Array.isArray(userIds)) return;
    const recipients = new Set(userIds);
    const frame = encodeTypeOnly(MSG_KEY_GRANTED);
    for (const room of this.rooms.values()) {
      if (room.dbId !== dbId) continue;
      for (const client of room.clients) {
        const user = this.clientUser.get(client);
        if (user !== undefined && recipients.has(user) && client.readyState === WebSocket.OPEN) {
          client.send(frame);
        }
      }
    }
  }

  /**
   * T16: a member says it's missing a grant. Relayed (locally and over Redis)
   * only in an E2EE room, only if the server agrees something is pending for
   * that user, and at most once a second per socket.
   */
  private handleKeyRequest(client: WebSocket, room: RoomState): void {
    const userId = this.clientUser.get(client);
    const dbId = room.dbId;
    if (!userId || !dbId || room.currentKeyId <= 0 || room.roomId === 'default') return;
    const now = Date.now();
    const last = this.lastKeyRequestAt.get(client);
    if (last !== undefined && now - last < KEY_REQUEST_MIN_INTERVAL_MS) return;
    this.lastKeyRequestAt.set(client, now);

    void this.roomKeys
      .hasPendingFor(dbId, userId)
      .then((pending) => {
        if (!pending) return;
        this.relayKeyRequest(dbId, userId);
        const payload: KeyRequestPayload = { origin: this.instanceId, userId };
        return this.pub.publish(`${KEY_REQUEST_CHANNEL_PREFIX}${dbId}`, JSON.stringify(payload));
      })
      .catch((err: Error) => this.logger.warn(`Failed to relay key request: ${err.message}`));
  }

  /**
   * Raises the epoch of every loaded copy of a room and pushes it to that
   * room's clients, so a member already in the room gates its composer right
   * away instead of after its next refresh (T10). The window this leaves on
   * OTHER instances is unbounded, not "a few ms": Redis pub/sub is
   * at-most-once, and nothing re-reads the epoch from the DB for a room that
   * stays loaded — a missed room:epoch message leaves it ungated until it is
   * GC'd and reloaded. Defense in depth only; the client gate is primary.
   */
  private raiseEpoch(dbId: string, keyId: number): void {
    if (typeof keyId !== 'number') return;
    this.epochByDbId.set(dbId, Math.max(this.epochByDbId.get(dbId) ?? 0, keyId));
    for (const room of this.rooms.values()) {
      if (room.dbId !== dbId || keyId <= room.currentKeyId) continue;
      room.currentKeyId = keyId;
      const frame = encodeRoomEpoch(keyId);
      for (const client of room.clients) client.send(frame);
    }
  }

  afterInit(server: Server): void {
    this.server = server;
    this.heartbeatTimer = setInterval(() => this.sweepHeartbeats(), HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async handleConnection(client: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url!, 'http://localhost');
    const roomId = url.searchParams.get('room') ?? 'default';

    // Token arrives via Sec-WebSocket-Protocol: "bearer, <jwt>" — not the query string.
    const offered = (req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map(s => s.trim());
    const token = offered[0] === 'bearer' ? offered[1] ?? '' : '';

    let userId: string;
    try {
      const payload = this.jwt.verify(token) as { sub: string };
      userId = payload.sub;
    } catch {
      client.close(4001, 'Unauthorized');
      return;
    }

    // 'default' is an open lobby — any authenticated user may join.
    // All other rooms require explicit membership (POST /rooms or POST /rooms/:name/join).
    if (roomId !== 'default') {
      const allowed = await this.roomsService.isMember(roomId, userId);
      if (!allowed) {
        client.close(4003, 'Forbidden');
        return;
      }
    }

    const room = await this.getOrCreateRoom(roomId);

    room.clients.add(client);
    this.clientRoom.set(client, roomId);
    this.clientUser.set(client, userId);
    this.metrics.incWsConnections();

    // Heartbeat liveness: alive on connect, re-armed on every pong.
    this.alive.set(client, true);
    client.on('pong', () => this.alive.set(client, true));

    // T10: tell the client the room is E2EE before anything else, so a stale
    // cached summary can't keep its composer in plaintext mode.
    if (room.currentKeyId > 0 && room.roomId !== 'default') {
      client.send(encodeRoomEpoch(room.currentKeyId));
    }

    // Step 1 — send server state vector so client can compute the diff it needs to send us
    const enc1 = encoding.createEncoder();
    encoding.writeVarUint(enc1, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc1, room.doc);
    client.send(encoding.toUint8Array(enc1));

    // Step 2 — push full current state to the new client (empty SV = full snapshot)
    const enc2 = encoding.createEncoder();
    encoding.writeVarUint(enc2, MSG_SYNC);
    syncProtocol.writeSyncStep2(enc2, room.doc, new Uint8Array([0]));
    client.send(encoding.toUint8Array(enc2));

    // Awareness snapshot — so onlineCount / typing are correct before the next change
    const states = room.awareness.getStates();
    if (states.size > 0) {
      const enc3 = encoding.createEncoder();
      encoding.writeVarUint(enc3, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        enc3,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
      );
      client.send(encoding.toUint8Array(enc3));
    }

    const onMessage = (data: RawData) => this.handleMessage(client, room, data as Buffer);
    const onClose = () => client.removeAllListeners('message');
    client.on('message', onMessage);
    client.once('close', onClose);

    this.logger.log(`Client connected to room "${roomId}". Room size: ${room.clients.size}`);
  }

  handleDisconnect(client: WebSocket) {
    const roomId = this.clientRoom.get(client);
    if (!roomId) return;
    this.clientRoom.delete(client);

    // Decrement here, before the room-lookup miss-return below: incWsConnections
    // was called unconditionally in handleConnection whenever clientRoom got an
    // entry for this client, so the connection is going away either way — even
    // if the room itself was already GC'd out from under it.
    this.metrics.decWsConnections();

    const room = this.rooms.get(roomId);
    if (!room) return;

    room.clients.delete(client);

    // Clear this socket's awareness states so it doesn't linger as a ghost
    // online user / stuck typing indicator. The awareness 'update' handler
    // propagates the removal to local clients and other instances.
    const ids = this.awarenessIds.get(client);
    if (ids && ids.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, [...ids], 'disconnect');
      this.awarenessIds.delete(client);
    }

    this.logger.log(`Client disconnected from room "${roomId}". Room size: ${room.clients.size}`);

    if (room.clients.size === 0) {
      setTimeout(() => {
        if (room.clients.size === 0) {
          // Flush any pending persist before GC
          const timer = this.persistTimers.get(roomId);
          if (timer) {
            clearTimeout(timer);
            this.persistTimers.delete(roomId);
            this.persistRoomState(room).catch(err =>
              this.logger.error(`Failed final persist for room "${roomId}": ${err.message}`)
            );
          }
          room.destroy();
          this.rooms.delete(roomId);
          this.roomInitMap.delete(roomId);
          this.metrics.decRoomsLoaded();
          this.metrics.removeYjsStateBytes(roomId);
        }
      }, ROOM_GC_DELAY_MS);
    }
  }

  private handleMessage(client: WebSocket, room: RoomState, data: Buffer) {
    if (data.length > MAX_WS_MESSAGE_BYTES) {
      this.logger.warn(`Oversized frame (${data.length}B) in room "${room.roomId}" — closing client`);
      client.close(1009, 'Message too large');
      return;
    }
    if (this.isRateLimited(client)) {
      this.logger.warn(`Rate limit exceeded in room "${room.roomId}" — closing client`);
      client.close(4029, 'Rate limit exceeded');
      return;
    }
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const msgType = decoding.readVarUint(decoder);

      if (msgType === MSG_SYNC) {
        this.metrics.incMessages('sync');
        const rejected = this.plaintextIntoE2eeRoom(room, decoder);
        if (rejected) {
          // Not applied, so never broadcast, published or persisted. Never
          // log the update itself — it holds the plaintext.
          this.metrics.incE2eeRejectedUpdates();
          this.logger.warn(
            `Rejected sync update with a non-E2E1 message in E2EE room "${room.roomId}" ` +
              `(epoch ${room.currentKeyId})`,
          );
          // Recovery (T10 review I1): the whole update was refused, including
          // any enveloped messages queued alongside the plaintext. Name the
          // offending message ids (never their content) so the client deletes
          // them locally, then ask for its state again: its next step2 carries
          // the deleted items as content-less structs and everything else
          // lands, instead of the same step2 bouncing on every reconnect.
          client.send(encodeE2eeRejected(room.currentKeyId, rejected.rejectedMessageIds));
          this.askForResync(client, room, data);
          return;
        }
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        // readSyncMessage applies the client's update to room.doc with `client`
        // as the transaction origin. Local fan-out, Redis publish and persist
        // are all driven from the doc 'update' handler in registerRoomUpdateHandler.
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, client);

        if (encoding.length(encoder) > 1) {
          client.send(encoding.toUint8Array(encoder));
        }
      } else if (msgType === MSG_AWARENESS) {
        this.metrics.incMessages('awareness');
        // Apply with `client` as origin; the awareness 'update' handler tracks
        // the client's IDs, fans out to local clients and publishes to Redis.
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, client);
      } else if (msgType === MSG_KEY_REQUEST) {
        this.handleKeyRequest(client, room);
      }
    } catch (err: any) {
      this.logger.error(`Error handling message: ${err.message}`);
    }
  }

  /**
   * T10: after a rejection, ask the client for its state again (sync step1).
   * The same refused frame arriving again means the client couldn't repair
   * it; re-asking at once would just loop, so repeats wait 1s, 2s, 4s… (max
   * 30s), and only the latest pending re-ask fires.
   */
  private askForResync(client: WebSocket, room: RoomState, refused: Buffer): void {
    const signature = createHash('sha256').update(refused).digest('hex');
    const previous = this.lastRejection.get(client);
    if (previous?.timer) clearTimeout(previous.timer);
    const repeats = previous?.signature === signature ? previous.repeats + 1 : 0;
    const state: RejectionState = { signature, repeats, timer: null };
    this.lastRejection.set(client, state);

    const sendStep1 = () => {
      state.timer = null;
      if (client.readyState !== WebSocket.OPEN) return;
      const step1 = encoding.createEncoder();
      encoding.writeVarUint(step1, MSG_SYNC);
      syncProtocol.writeSyncStep1(step1, room.doc);
      client.send(encoding.toUint8Array(step1));
    };
    if (repeats === 0) {
      sendStep1();
      return;
    }
    const delay = Math.min(REJECT_RESYNC_BASE_MS * 2 ** (repeats - 1), REJECT_RESYNC_MAX_MS);
    state.timer = setTimeout(sendStep1, delay);
    state.timer.unref?.();
  }

  /**
   * T10 defense in depth: in a room whose currentKeyId > 0, a sync step2 or
   * update that inserts any message without a well-formed E2E1 envelope is
   * rejected whole; returns the offending message ids, or null to accept.
   * Peeks on a clone of the decoder so the caller still reads the message
   * from the start. The 'default' lobby is always plaintext (ADR-010
   * amendment #3), so it's never gated.
   */
  private plaintextIntoE2eeRoom(
    room: RoomState,
    decoder: decoding.Decoder,
  ): { rejectedMessageIds: string[] } | null {
    if (room.currentKeyId <= 0 || room.roomId === 'default') return null;
    const peek = decoding.clone(decoder);
    const syncType = decoding.readVarUint(peek);
    if (syncType !== SYNC_STEP2 && syncType !== SYNC_UPDATE) return null;
    const result = checkEnvelopedUpdate(decoding.readVarUint8Array(peek));
    return result.ok ? null : result;
  }

  /** Fixed-window per-client message rate limiter. */
  private isRateLimited(client: WebSocket): boolean {
    const now = Date.now();
    const state = this.clientRate.get(client);
    if (!state || now - state.windowStart >= RATE_LIMIT_WINDOW_MS) {
      this.clientRate.set(client, { count: 1, windowStart: now });
      return false;
    }
    state.count++;
    return state.count > RATE_LIMIT_MAX_MSGS;
  }

  /**
   * Ping every client; terminate any that missed the previous cycle's pong.
   * `terminate()` fires 'close', so handleDisconnect runs the normal cleanup
   * (awareness removal + room GC) — no special-casing here.
   */
  sweepHeartbeats(): void {
    this.server.clients.forEach((client: WebSocket) => {
      if (this.alive.get(client) === false) {
        this.logger.warn('Heartbeat timeout — terminating dead socket');
        client.terminate();
        return;
      }
      this.alive.set(client, false);
      client.ping();
    });
  }

  private getOrCreateRoom(roomId: string): Promise<RoomState> {
    let p = this.roomInitMap.get(roomId);
    if (!p) {
      const room = new RoomState(roomId);
      this.rooms.set(roomId, room);
      // Incremented only once loadRoomState actually succeeds — incrementing
      // eagerly here would leak the gauge upward on a load failure (Prisma
      // error etc.) with nothing to balance it back down.
      p = this.loadRoomState(room).then(() => {
        this.metrics.incRoomsLoaded();
        this.registerRoomUpdateHandler(room);
        this.registerRoomAwarenessHandler(room);
        return room;
      });
      this.roomInitMap.set(roomId, p);
    }
    return p;
  }

  /**
   * Single source of truth for doc propagation. Fires on every doc mutation
   * with the true incremental update and its transaction origin:
   * - a client WebSocket  → another instance hasn't seen it: publish to Redis + persist
   * - 'redis'             → already came from another instance: fan out locally only
   * In all cases, fan the delta out to local clients except the originating one.
   */
  private registerRoomUpdateHandler(room: RoomState): void {
    room.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const msg = encoding.toUint8Array(encoder);

      room.clients.forEach(client => {
        if (client !== origin && client.readyState === WebSocket.OPEN) client.send(msg);
      });

      if (origin === 'redis') return; // came from another instance — don't echo back

      const payload: RedisPayload = {
        origin: this.instanceId,
        update: Buffer.from(update).toString('base64'),
      };
      this.pub.publish(`${UPDATE_CHANNEL_PREFIX}${room.roomId}`, JSON.stringify(payload));
      this.metrics.incFanoutBytes(update.byteLength, 'doc');
      this.schedulePersist(room);
    });
  }

  /**
   * Single source of truth for awareness (presence/typing) propagation.
   * Mirrors registerRoomUpdateHandler: fan out to local clients, track each
   * socket's controlled clientIDs for disconnect cleanup, and forward to other
   * instances via Redis unless the change itself came from Redis.
   */
  private registerRoomAwarenessHandler(room: RoomState): void {
    room.awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const changed = [...added, ...updated, ...removed];
        if (changed.length === 0) return;

        if (origin instanceof WebSocket && room.clients.has(origin)) {
          let set = this.awarenessIds.get(origin);
          if (!set) {
            set = new Set();
            this.awarenessIds.set(origin, set);
          }
          for (const id of added) set.add(id);
          for (const id of updated) set.add(id);
          for (const id of removed) set.delete(id);
        }

        const update = awarenessProtocol.encodeAwarenessUpdate(room.awareness, changed);
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_AWARENESS);
        encoding.writeVarUint8Array(enc, update);
        const msg = encoding.toUint8Array(enc);

        room.clients.forEach(client => {
          if (client !== origin && client.readyState === WebSocket.OPEN) client.send(msg);
        });

        if (origin === 'redis') return; // already from another instance

        const payload: RedisPayload = {
          origin: this.instanceId,
          update: Buffer.from(update).toString('base64'),
        };
        this.pub.publish(`${AWARENESS_CHANNEL_PREFIX}${room.roomId}`, JSON.stringify(payload));
        this.metrics.incFanoutBytes(update.byteLength, 'awareness');
      },
    );
  }

  private async loadRoomState(room: RoomState): Promise<void> {
    const dbRoom = await this.prisma.room.findUnique({ where: { name: room.roomId } });
    if (dbRoom) {
      room.dbId = dbRoom.id;
      // max(): an epoch claim may have committed after the read above.
      room.currentKeyId = Math.max(
        room.currentKeyId,
        dbRoom.currentKeyId,
        this.epochByDbId.get(dbRoom.id) ?? 0,
      );
    }
    if (dbRoom?.yjsState) {
      Y.applyUpdate(room.doc, new Uint8Array(dbRoom.yjsState));
    } else {
      const upserted = await this.prisma.room.upsert({
        where: { name: room.roomId },
        create: { name: room.roomId },
        update: {},
      });
      room.dbId ??= upserted?.id ?? null;
    }
  }

  private schedulePersist(room: RoomState): void {
    const existing = this.persistTimers.get(room.roomId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.persistTimers.delete(room.roomId);
      this.persistRoomState(room).catch(err =>
        this.logger.error(`Failed to persist room "${room.roomId}": ${err.message}`)
      );
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimers.set(room.roomId, timer);
  }

  private async persistRoomState(room: RoomState): Promise<void> {
    const start = process.hrtime.bigint();
    const state = Y.encodeStateAsUpdate(room.doc);
    this.warnIfStateLarge(room.roomId, state.byteLength);
    this.metrics.setYjsStateBytes(room.roomId, state.byteLength);
    await this.prisma.room.update({
      where: { name: room.roomId },
      data: { yjsState: Buffer.from(state) },
    });
    this.metrics.observePersistDurationSeconds(Number(process.hrtime.bigint() - start) / 1e9);
  }

  /** Trip the ADR-009 retention trigger: warn once per persist past the cap. */
  private warnIfStateLarge(roomId: string, bytes: number): void {
    if (bytes >= YJS_STATE_WARN_BYTES) {
      this.logger.warn(
        `Room "${roomId}" yjsState is ${bytes}B (>= ${YJS_STATE_WARN_BYTES}) — ` +
          `consider ADR-009 epoch compaction`,
      );
    }
  }
}

/** T10 ROOM_EPOCH frame: varUint type, varUint keyId. */
function encodeRoomEpoch(keyId: number): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_ROOM_EPOCH);
  encoding.writeVarUint(encoder, keyId);
  return encoding.toUint8Array(encoder);
}

/** T16 KEY_REQUEST / KEY_GRANTED frames: the varUint type alone. */
function encodeTypeOnly(type: number): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  return encoding.toUint8Array(encoder);
}

/** T10 E2EE_REJECTED frame: varUint type, varUint keyId, varUint n, n varString message ids. */
function encodeE2eeRejected(keyId: number, messageIds: string[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_E2EE_REJECTED);
  encoding.writeVarUint(encoder, keyId);
  encoding.writeVarUint(encoder, messageIds.length);
  for (const id of messageIds) encoding.writeVarString(encoder, id);
  return encoding.toUint8Array(encoder);
}
