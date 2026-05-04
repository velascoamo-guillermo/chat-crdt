import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
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
import { RoomState } from './room-state';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const ROOM_GC_DELAY_MS = 30_000;

@WebSocketGateway({ path: '/sync' })
export class SyncGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(SyncGateway.name);
  private readonly rooms = new Map<string, RoomState>();
  private readonly clientRoom = new WeakMap<WebSocket, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject('REDIS_PUB') private readonly pub: Redis,
    @Inject('REDIS_SUB') private readonly sub: Redis,
  ) {}

  onModuleInit() {
    this.sub.psubscribe('room:update:*');
    this.sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const roomId = channel.replace('room:update:', '');
      const room = this.rooms.get(roomId);
      if (!room) return;

      const update = Buffer.from(message, 'base64');
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const msg = encoding.toUint8Array(encoder);

      room.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      });
    });
  }

  async handleConnection(client: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url!, 'http://localhost');
    const roomId = url.searchParams.get('room') ?? 'default';
    const token = url.searchParams.get('token') ?? '';

    try {
      this.jwt.verify(token);
    } catch {
      client.close(4001, 'Unauthorized');
      return;
    }

    let room = this.rooms.get(roomId);
    if (!room) {
      room = new RoomState(roomId);
      this.rooms.set(roomId, room);
      await this.loadRoomState(room);
    }

    room.clients.add(client);
    this.clientRoom.set(client, roomId);

    // Sync step 1 — send server state vector so client can send diff
    const enc1 = encoding.createEncoder();
    encoding.writeVarUint(enc1, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc1, room.doc);
    client.send(encoding.toUint8Array(enc1));

    // Sync step 2 — send full current state to new client
    const enc2 = encoding.createEncoder();
    encoding.writeVarUint(enc2, MSG_SYNC);
    syncProtocol.writeSyncStep2(enc2, room.doc, Y.encodeStateVector(room.doc));
    client.send(encoding.toUint8Array(enc2));

    client.on('message', (data: RawData) => {
      this.handleMessage(client, room!, data as Buffer);
    });

    this.logger.log(`Client connected to room "${roomId}". Room size: ${room.clients.size}`);
  }

  handleDisconnect(client: WebSocket) {
    const roomId = this.clientRoom.get(client);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.clients.delete(client);
    this.logger.log(`Client disconnected from room "${roomId}". Room size: ${room.clients.size}`);

    if (room.clients.size === 0) {
      setTimeout(() => {
        if (room.clients.size === 0) {
          room.destroy();
          this.rooms.delete(roomId);
        }
      }, ROOM_GC_DELAY_MS);
    }
  }

  private handleMessage(client: WebSocket, room: RoomState, data: Buffer) {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const msgType = decoding.readVarUint(decoder);

      if (msgType === MSG_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        const syncState = syncProtocol.readSyncMessage(decoder, encoder, room.doc, client);

        if (encoding.length(encoder) > 1) {
          client.send(encoding.toUint8Array(encoder));
        }

        // Broadcast update to other instances via Redis
        if (syncState === 2 /* messageYjsUpdate */ || syncState === 1 /* syncStep2 */) {
          const update = Y.encodeStateAsUpdate(room.doc);
          this.pub.publish(
            `room:update:${room.roomId}`,
            Buffer.from(update).toString('base64'),
          );
          // Persist Yjs state to DB (fire-and-forget, errors logged)
          this.persistRoomState(room).catch(err =>
            this.logger.error(`Failed to persist room "${room.roomId}": ${err.message}`)
          );
        }
      } else if (msgType === MSG_AWARENESS) {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, client);

        // Relay awareness to other clients in room
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_AWARENESS);
        encoding.writeVarUint8Array(enc, update);
        const msg = encoding.toUint8Array(enc);
        room.clients.forEach(c => {
          if (c !== client && c.readyState === WebSocket.OPEN) c.send(msg);
        });
      }
    } catch (err: any) {
      this.logger.error(`Error handling message from client: ${err.message}`);
    }
  }

  private async loadRoomState(room: RoomState) {
    const dbRoom = await this.prisma.room.findUnique({ where: { name: room.roomId } });
    if (dbRoom?.yjsState) {
      Y.applyUpdate(room.doc, new Uint8Array(dbRoom.yjsState));
    } else {
      await this.prisma.room.upsert({
        where: { name: room.roomId },
        create: { name: room.roomId },
        update: {},
      });
    }
  }

  private async persistRoomState(room: RoomState) {
    const state = Y.encodeStateAsUpdate(room.doc);
    await this.prisma.room.update({
      where: { name: room.roomId },
      data: { yjsState: Buffer.from(state) },
    });
  }
}
