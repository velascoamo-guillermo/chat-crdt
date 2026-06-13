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
    // Awareness sets a local state ({}) for its own clientID in the constructor.
    // The server is a relay, not a chat participant — drop that state so it
    // isn't broadcast to clients as a phantom "online" user.
    this.awareness.setLocalState(null);
  }

  destroy() {
    this.awareness.destroy();
    this.doc.destroy();
  }
}
