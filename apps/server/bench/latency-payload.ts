/**
 * Encodes/decodes the timestamped payload the bench publisher writes into
 * each Y.Array message (as the `content` field of a MessageDto-shaped
 * entry) and extracts one-way latency from it. Pure — no I/O.
 */

export interface TimestampedPayload {
  seq: number;
  sentAt: number;
}

function isTimestampedPayload(value: unknown): value is TimestampedPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).seq === 'number' &&
    typeof (value as Record<string, unknown>).sentAt === 'number'
  );
}

export function encodeTimestampedPayload(seq: number, sentAt: number): string {
  const payload: TimestampedPayload = { seq, sentAt };
  return JSON.stringify(payload);
}

export function decodeTimestampedPayload(raw: string): TimestampedPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid timestamped payload (not JSON): ${raw}`);
  }
  if (!isTimestampedPayload(parsed)) {
    throw new Error(`Invalid timestamped payload (missing seq/sentAt): ${raw}`);
  }
  return parsed;
}

/** One-way latency in ms: the receiver's clock minus the sender's embedded `sentAt`. */
export function latencyFromPayload(raw: string, receivedAt: number): number {
  const { sentAt } = decodeTimestampedPayload(raw);
  return receivedAt - sentAt;
}
