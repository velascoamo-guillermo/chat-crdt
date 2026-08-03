import { describe, test, expect } from 'bun:test';
import { createServer, type Server } from 'node:net';
import { createHash } from 'node:crypto';
import { RawWsSocket } from './raw-ws-socket';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeUnmaskedFrame(payload: string): Buffer {
  const data = Buffer.from(payload, 'utf8');
  if (data.length >= 126) throw new Error('test helper only supports short payloads');
  return Buffer.concat([Buffer.from([0x82, data.length]), data]); // FIN + binary opcode, unmasked
}

/**
 * A minimal fake WS server that, in ONE `socket.write`, sends the 101
 * handshake response immediately followed by two data frames — reproducing
 * "server frames arrive in the same TCP chunk as the 101 response" exactly
 * as `sync.gateway.ts` does (it sends SyncStep1 + SyncStep2 unconditionally
 * right after upgrading, see `handleConnection`).
 */
function startFakeServer(): Promise<{ port: number; close: () => void }> {
  return new Promise(resolve => {
    const server: Server = createServer(socket => {
      let buf = Buffer.alloc(0);
      socket.on('data', chunk => {
        buf = Buffer.concat([buf, chunk]);
        const headerEnd = buf.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;

        const headerText = buf.subarray(0, headerEnd).toString('utf8');
        const keyMatch = /sec-websocket-key:\s*(\S+)/i.exec(headerText);
        if (!keyMatch) return;
        const accept = createHash('sha1').update(keyMatch[1] + WS_GUID).digest('base64');

        const responseHeaders =
          'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`;

        socket.write(
          Buffer.concat([
            Buffer.from(responseHeaders, 'utf8'),
            encodeUnmaskedFrame('frame1'),
            encodeUnmaskedFrame('frame2'),
          ]),
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}

describe('RawWsSocket', () => {
  test('delivers frames that arrive in the same TCP chunk as the 101 response, even when the consumer attaches handlers asynchronously', async () => {
    const { port, close } = await startFakeServer();
    try {
      const client = await RawWsSocket.connect(`ws://127.0.0.1:${port}/`, []);

      // Simulate a consumer doing real async work (e.g. constructing a Y.Doc,
      // awaiting something else) before calling .on() — exactly the window
      // in which the original implementation silently dropped frames that
      // had already been synchronously parsed out of the handshake chunk.
      await new Promise(r => setTimeout(r, 10));

      const received: string[] = [];
      const done = new Promise<void>(resolveDone => {
        client.on({
          onMessage: data => {
            received.push(Buffer.from(data).toString('utf8'));
            if (received.length === 2) resolveDone();
          },
        });
      });

      await Promise.race([
        done,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timed out waiting for frames — frames were dropped')), 2000),
        ),
      ]);

      expect(received).toEqual(['frame1', 'frame2']);
    } finally {
      close();
    }
  });
});
