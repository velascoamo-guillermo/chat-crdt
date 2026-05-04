import * as Y from 'yjs';
import { MessageDto } from '@chat-crdt/shared';
import { SyncEngineConfig } from './types';

export class SyncEngine {
  readonly doc: Y.Doc;
  private readonly messages: Y.Array<MessageDto>;
  private readonly config: SyncEngineConfig;

  constructor(config: SyncEngineConfig) {
    this.config = config;
    this.doc = new Y.Doc();
    this.messages = this.doc.getArray<MessageDto>('messages');
  }

  sendMessage(content: string): MessageDto {
    const msg: MessageDto = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      roomId: this.config.roomId,
      userId: this.config.userId,
      username: this.config.username,
      content,
      createdAt: Date.now(),
    };
    this.doc.transact(() => {
      this.messages.push([msg]);
    });
    return msg;
  }

  getMessages(): MessageDto[] {
    return this.messages.toArray();
  }

  subscribe(callback: (messages: MessageDto[]) => void): () => void {
    const handler = () => callback(this.getMessages());
    this.messages.observe(handler);
    return () => this.messages.unobserve(handler);
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
    this.doc.destroy();
  }
}
