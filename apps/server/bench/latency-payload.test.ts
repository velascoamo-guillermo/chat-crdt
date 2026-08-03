import { describe, test, expect } from 'bun:test';
import { encodeTimestampedPayload, decodeTimestampedPayload, latencyFromPayload } from './latency-payload';

describe('encodeTimestampedPayload / decodeTimestampedPayload', () => {
  test('round-trips seq and sentAt through JSON', () => {
    const raw = encodeTimestampedPayload(7, 1_700_000_000_123);
    expect(decodeTimestampedPayload(raw)).toEqual({ seq: 7, sentAt: 1_700_000_000_123 });
  });

  test('throws on malformed JSON', () => {
    expect(() => decodeTimestampedPayload('not json')).toThrow(/invalid timestamped payload/i);
  });

  test('throws when seq is missing', () => {
    expect(() => decodeTimestampedPayload(JSON.stringify({ sentAt: 1 }))).toThrow(
      /invalid timestamped payload/i,
    );
  });

  test('throws when sentAt is not a number', () => {
    expect(() => decodeTimestampedPayload(JSON.stringify({ seq: 1, sentAt: 'x' }))).toThrow(
      /invalid timestamped payload/i,
    );
  });
});

describe('latencyFromPayload', () => {
  test('computes receivedAt - sentAt embedded in the payload', () => {
    const raw = encodeTimestampedPayload(3, 1000);
    expect(latencyFromPayload(raw, 1042)).toBe(42);
  });

  test('propagates the decode error for a malformed payload', () => {
    expect(() => latencyFromPayload('garbage', 1042)).toThrow(/invalid timestamped payload/i);
  });
});
