import * as Y from 'yjs';
import { ulid } from 'ulid';
import { MessageDto, MAX_MESSAGE_LENGTH } from '@chat-crdt/shared';
import { SyncEngineConfig } from './types';

export class SyncEngine {
  readonly doc: Y.Doc;
  private readonly messages: Y.Array<MessageDto>;
  private readonly config: SyncEngineConfig;
  private readonly subscriptions = new Set<(event: Y.YArrayEvent<MessageDto>) => void>();

  get roomId(): string {
    return this.config.roomId;
  }

  constructor(config: SyncEngineConfig) {
    this.config = config;
    this.doc = new Y.Doc({ gc: true });
    this.messages = this.doc.getArray<MessageDto>('messages');
  }

  sendMessage(content: string): MessageDto {
    const trimmed = content.trim();
    if (!trimmed) throw new Error('Cannot send an empty message');
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message exceeds ${MAX_MESSAGE_LENGTH} characters`);
    }
    const id = ulid();
    const createdAt = Date.now();
    const { roomId, userId, username, contentCipher } = this.config;

    // ADR-010: AAD is composed here, post-compose pre-insert, from the exact
    // fields the engine just generated (id, createdAt) plus the config ones
    // — app code calling sendMessage cannot construct this AAD itself, which
    // is why encryption lives inside the engine, not above it.
    const storedContent = contentCipher
      ? contentCipher.encrypt(trimmed, { id, roomId, userId, username, createdAt })
      : trimmed;

    const msg: MessageDto = {
      id,
      roomId,
      userId,
      username,
      content: storedContent,
      createdAt,
    };
    this.messages.push([msg]);
    return msg;
  }

  /**
   * T10: deletes this user's messages with these ids (one transaction) and
   * returns them. Used when the server refuses plaintext messages in an E2EE
   * room. The doc garbage-collects deleted content, so the encoded state —
   * and with it the next sync step2 — no longer carries the retracted text.
   * Scoped to our own userId: a deletion propagates to every member, so a
   * named id must never take down someone else's message. (Not scoped to
   * doc.clientID — a reloaded doc gets a new one, and its offline items
   * must still be retractable.)
   */
  retractMessages(ids: readonly string[]): MessageDto[] {
    const wanted = new Set(ids);
    const retracted: MessageDto[] = [];
    this.doc.transact(() => {
      const all = this.messages.toArray();
      for (let i = all.length - 1; i >= 0; i--) {
        if (!wanted.has(all[i].id) || all[i].userId !== this.config.userId) continue;
        retracted.unshift(all[i]);
        this.messages.delete(i, 1);
      }
    });
    return retracted;
  }

  /**
   * T10: appends messages verbatim (same id, createdAt and already-encrypted
   * content, so their AAD stays valid) unless the doc already holds that id.
   * Used to put back the user's own encrypted messages after a discarded doc
   * was resynced from the server. Returns what was inserted.
   */
  reinsertMessages(messages: readonly MessageDto[]): MessageDto[] {
    const present = new Set(this.messages.toArray().map((m) => m.id));
    const missing = messages.filter((m) => !present.has(m.id));
    if (missing.length > 0) this.messages.push(missing.map((m) => ({ ...m })));
    return missing;
  }

  getMessages(): MessageDto[] {
    return this.messages.toArray();
  }

  subscribe(callback: (messages: MessageDto[]) => void): () => void {
    const handler = () => callback(this.getMessages());
    this.subscriptions.add(handler);
    this.messages.observe(handler);
    return () => {
      this.messages.unobserve(handler);
      this.subscriptions.delete(handler);
    };
  }

  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  applyUpdate(update: Uint8Array, origin?: unknown): void {
    Y.applyUpdate(this.doc, update, origin);
  }

  encodeStateVector(): Uint8Array {
    return Y.encodeStateVector(this.doc);
  }

  encodeStateDiff(remoteStateVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, remoteStateVector);
  }

  destroy(): void {
    for (const handler of this.subscriptions) {
      this.messages.unobserve(handler);
    }
    this.subscriptions.clear();
    this.doc.destroy();
  }
}
