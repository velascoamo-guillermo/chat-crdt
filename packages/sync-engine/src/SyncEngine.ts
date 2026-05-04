import * as Y from 'yjs';
import { ulid } from 'ulid';
import { MessageDto } from '@chat-crdt/shared';
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
    this.doc = new Y.Doc();
    this.messages = this.doc.getArray<MessageDto>('messages');
  }

  sendMessage(content: string): MessageDto {
    const msg: MessageDto = {
      id: ulid(),
      roomId: this.config.roomId,
      userId: this.config.userId,
      username: this.config.username,
      content,
      createdAt: Date.now(),
    };
    this.messages.push([msg]);
    return msg;
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
