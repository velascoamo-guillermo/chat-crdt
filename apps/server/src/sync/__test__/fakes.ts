import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';

const OPEN = 1;
const CLOSED = 3;

/** Stand-in for a `ws` WebSocket: real EventEmitter (so on/once/emit work),
 *  jest-spied send/close/terminate/ping, and inspectable sent/close records. */
export class FakeSocket extends EventEmitter {
  readyState = OPEN;
  sent: Uint8Array[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  terminated = false;

  send = jest.fn((data: Uint8Array) => {
    this.sent.push(data);
  });
  close = jest.fn((code?: number, reason?: string) => {
    this.closeCalls.push({ code, reason });
    this.readyState = CLOSED;
  });
  terminate = jest.fn(() => {
    this.terminated = true;
    this.readyState = CLOSED;
    this.emit('close');
  });
  ping = jest.fn();

  lastCloseCode(): number | undefined {
    return this.closeCalls.at(-1)?.code;
  }
}

/** Minimal IncomingMessage: url carries the room, header carries the token. */
export function fakeReq(opts: { room?: string; token?: string } = {}): IncomingMessage {
  const room = opts.room ?? 'default';
  const protocol = opts.token ? `bearer, ${opts.token}` : '';
  return {
    url: `/sync?room=${room}`,
    headers: { 'sec-websocket-protocol': protocol },
  } as unknown as IncomingMessage;
}

export function redisMock() {
  return {
    publish: jest.fn(),
    psubscribe: jest.fn(),
    on: jest.fn(),
  };
}
