import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { WebSocket } from 'ws';
import type { MessageDto } from '@chat-crdt/shared';

export class RoomState {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly clients: Set<WebSocket> = new Set();

  constructor(public readonly roomId: string) {
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
  }

  getMessages(): MessageDto[] {
    return this.doc.getArray<MessageDto>('messages').toArray();
  }

  destroy() {
    this.awareness.destroy();
    this.doc.destroy();
  }
}
