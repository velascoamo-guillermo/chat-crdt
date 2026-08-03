/**
 * Minimal RFC 6455 WebSocket client over a raw TCP socket.
 *
 * WHY: the real auth handshake (sync.gateway.ts / WebSocketProvider.ts) sends
 * the JWT via a TWO-element `Sec-WebSocket-Protocol: bearer, <token>` header
 * (see ADR-003). Bun's native `WebSocket` (and its shimmed `ws` import) both
 * fail multi-element subprotocol offers with `SyntaxError: Mismatch client
 * protocol` even though the server (the standard `ws` package) negotiates
 * them correctly — this reproduces under plain `bun run bench/run.ts` with
 * no other code involved, i.e. it's a Bun runtime limitation, not a bug in
 * this harness or the server. Single-protocol offers work fine in Bun; only
 * 2+ element arrays trigger it. Rather than weaken the auth handshake the
 * bench exercises, this module implements just enough of RFC 6455 (client
 * handshake + masked frame send / unmasked frame receive) to drive the real
 * multi-protocol header over `node:net`, which is unaffected.
 */
import { connect, type Socket } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

export interface RawWsSocketEvents {
  onMessage?: (data: Uint8Array) => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (err: Error) => void;
}

export class RawWsSocket {
  private socket: Socket | null = null;
  private recvBuffer: Buffer = Buffer.alloc(0);
  private closed = false;
  private events: RawWsSocketEvents = {};

  static connect(url: string, protocols: readonly string[], timeoutMs = 10_000): Promise<RawWsSocket> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const port = parsed.port ? Number(parsed.port) : 80;
      const path = `${parsed.pathname}${parsed.search}`;
      const key = randomBytes(16).toString('base64');
      const expectedAccept = createHash('sha1').update(key + WS_GUID).digest('base64');

      const client = new RawWsSocket();
      const socket = connect({ host: parsed.hostname, port }, () => {
        const headerLines = [
          `GET ${path} HTTP/1.1`,
          `Host: ${parsed.hostname}:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
        ];
        if (protocols.length > 0) {
          headerLines.push(`Sec-WebSocket-Protocol: ${protocols.join(', ')}`);
        }
        socket.write(headerLines.join('\r\n') + '\r\n\r\n');
      });
      client.socket = socket;

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`WS handshake to ${url} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      let handshakeDone = false;
      let handshakeBuffer = Buffer.alloc(0);

      const onHandshakeData = (chunk: Buffer): void => {
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
        const headerEnd = handshakeBuffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;

        const headerText = handshakeBuffer.subarray(0, headerEnd).toString('utf8');
        const rest = handshakeBuffer.subarray(headerEnd + 4);
        handshakeDone = true;
        socket.off('data', onHandshakeData);

        const statusLine = headerText.split('\r\n')[0] ?? '';
        if (!/^HTTP\/1\.1 101/.test(statusLine)) {
          clearTimeout(timeout);
          socket.destroy();
          reject(new Error(`WS handshake to ${url} failed: ${statusLine || '(no status line)'}`));
          return;
        }
        const acceptMatch = /sec-websocket-accept:\s*(\S+)/i.exec(headerText);
        if (!acceptMatch || acceptMatch[1] !== expectedAccept) {
          clearTimeout(timeout);
          socket.destroy();
          reject(new Error(`WS handshake to ${url} failed: bad Sec-WebSocket-Accept`));
          return;
        }

        clearTimeout(timeout);
        client.recvBuffer = rest;
        socket.on('data', chunk2 => client.onData(chunk2));
        socket.on('close', () => client.handleClose(1006, 'TCP connection closed'));
        socket.on('error', err => client.events.onError?.(err));
        resolve(client);
        if (client.recvBuffer.length > 0) client.processBuffer();
      };

      socket.on('data', onHandshakeData);
      socket.once('error', err => {
        if (!handshakeDone) {
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  on(events: RawWsSocketEvents): void {
    this.events = { ...this.events, ...events };
  }

  private onData(chunk: Buffer): void {
    this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);
    this.processBuffer();
  }

  /** Parses as many complete (unfragmented, unmasked — server frames) frames as are buffered. */
  private processBuffer(): void {
    for (;;) {
      if (this.recvBuffer.length < 2) return;
      const byte0 = this.recvBuffer[0];
      const byte1 = this.recvBuffer[1];
      const opcode = byte0 & 0x0f;
      const masked = (byte1 & 0x80) !== 0;
      let payloadLen = byte1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.recvBuffer.length < offset + 2) return;
        payloadLen = this.recvBuffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (this.recvBuffer.length < offset + 8) return;
        payloadLen = Number(this.recvBuffer.readBigUInt64BE(offset));
        offset += 8;
      }

      let maskKey: Buffer | null = null;
      if (masked) {
        if (this.recvBuffer.length < offset + 4) return;
        maskKey = this.recvBuffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.recvBuffer.length < offset + payloadLen) return; // wait for the rest of this frame

      let payload = this.recvBuffer.subarray(offset, offset + payloadLen);
      if (maskKey) {
        const unmasked = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) unmasked[i] = payload[i] ^ maskKey[i % 4];
        payload = unmasked;
      }

      this.recvBuffer = this.recvBuffer.subarray(offset + payloadLen);
      this.handleFrame(opcode, payload);
    }
  }

  private handleFrame(opcode: number, payload: Buffer): void {
    switch (opcode) {
      case OPCODE_BINARY:
      case OPCODE_TEXT:
        this.events.onMessage?.(new Uint8Array(payload));
        break;
      case OPCODE_CLOSE: {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
        this.handleClose(code, reason);
        break;
      }
      case OPCODE_PING:
        this.writeFrame(OPCODE_PONG, payload);
        break;
      case OPCODE_PONG:
        break;
      default:
        break;
    }
  }

  private handleClose(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.socket?.destroy();
    this.events.onClose?.(code, reason);
  }

  /** RFC 6455 requires client->server frames to be masked. */
  private writeFrame(opcode: number, payload: Uint8Array): void {
    if (this.closed || !this.socket) return;
    const len = payload.length;
    const maskKey = randomBytes(4);
    let header: Buffer;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode; // FIN=1

    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ maskKey[i % 4];

    this.socket.write(Buffer.concat([header, maskKey, masked]));
  }

  send(data: Uint8Array): void {
    this.writeFrame(OPCODE_BINARY, data);
  }

  close(code = 1000, reason = ''): void {
    if (this.closed || !this.socket) return;
    const reasonBuf = Buffer.from(reason, 'utf8');
    const payload = Buffer.alloc(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    this.writeFrame(OPCODE_CLOSE, payload);
    this.handleClose(code, reason);
  }
}
