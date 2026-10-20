import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { WebSocket } from 'ws';

export class RoomState {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly clients: Set<WebSocket> = new Set();
  /** Prisma Room.id, set on load — epoch events are keyed by it, not the name. */
  dbId: string | null = null;
  /**
   * ADR-010 epoch (0 = E2EE off). Loaded from the DB, then raised by epoch
   * claims (T10). Never lowered: epochs only increase server-side.
   */
  currentKeyId = 0;

  constructor(public readonly roomId: string) {
    this.doc = new Y.Doc({ gc: true });
    this.awareness = new awarenessProtocol.Awareness(this.doc);
  }

  destroy() {
    this.awareness.destroy();
    this.doc.destroy();
  }
}
