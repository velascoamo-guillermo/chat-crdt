import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { WebSocket } from 'ws';

export class RoomState {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly clients: Set<WebSocket> = new Set();

  constructor(public readonly roomId: string) {
    this.doc = new Y.Doc({ gc: true });
    this.awareness = new awarenessProtocol.Awareness(this.doc);
  }

  destroy() {
    this.awareness.destroy();
    this.doc.destroy();
  }
}
