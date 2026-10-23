import { describe, it, expect } from 'bun:test';
import {
  roomLabel,
  presenceLabel,
  headerPillA11yLabel,
  statusTone,
  backAction,
  pillSlotWidth,
  PILL_SLOT_MAX,
  truncateLabel,
  roomCharBudget,
  pillRoomLabel,
} from './headerPill';

describe('roomLabel', () => {
  it('maps the legacy default room to "# general"', () => {
    expect(roomLabel('default')).toBe('# general');
  });
  it('prefixes any other room slug with "# "', () => {
    expect(roomLabel('design')).toBe('# design');
  });
});

describe('presenceLabel', () => {
  it('1 online', () => {
    expect(presenceLabel(1)).toBe('1 online');
  });
  it('0 online', () => {
    expect(presenceLabel(0)).toBe('0 online');
  });
  it('N online', () => {
    expect(presenceLabel(3)).toBe('3 online');
  });
});

describe('statusTone', () => {
  it.each([
    ['connected', 'connected'],
    ['connecting', 'connecting'],
    ['disconnected', 'offline'],
    ['something-else', 'offline'],
    ['', 'offline'],
  ] as const)('%p → %s', (ws, tone) => {
    expect(statusTone(ws)).toBe(tone);
  });
});

describe('headerPillA11yLabel', () => {
  // Maestro contract: flows match the pill by its leading room label.
  it('starts with the room label', () => {
    expect(headerPillA11yLabel('default', 'connected', 3).startsWith('# general')).toBe(true);
    expect(headerPillA11yLabel('design', 'connecting', 1).startsWith('# design')).toBe(true);
  });
  it('reads room, status and presence', () => {
    expect(headerPillA11yLabel('default', 'connected', 3)).toBe('# general, connected, 3 online');
  });
  it('speaks a non-connected status as offline', () => {
    expect(headerPillA11yLabel('design', 'disconnected', 1)).toBe('# design, offline, 1 online');
  });
});

describe('backAction', () => {
  it('pops when there is history', () => {
    expect(backAction(true)).toBe('back');
  });
  it('replaces with rooms on a cold start into a room', () => {
    expect(backAction(false)).toBe('replace-rooms');
  });
});

describe('pillSlotWidth', () => {
  it('leaves room for both header discs', () => {
    expect(pillSlotWidth(390)).toBe(390 - 2 * 62);
  });
  it('caps on wide screens', () => {
    expect(pillSlotWidth(1024)).toBe(PILL_SLOT_MAX);
  });
  it('never goes negative', () => {
    expect(pillSlotWidth(100)).toBe(0);
  });
});

describe('truncateLabel', () => {
  it('keeps a label that fits', () => {
    expect(truncateLabel('# general', 9)).toBe('# general');
  });
  it('cuts with a trailing ellipsis to exactly maxChars', () => {
    const out = truncateLabel('# abcdefghijklmnop', 8);
    expect(out).toBe('# abcde…');
    expect(out.length).toBe(8);
  });
});

describe('roomCharBudget', () => {
  it('grows with the slot', () => {
    expect(roomCharBudget(280)).toBeGreaterThan(roomCharBudget(200));
  });
  it('fits "# general" on a 390pt phone', () => {
    expect(roomCharBudget(pillSlotWidth(390))).toBeGreaterThanOrEqual('# general'.length);
  });
  it('never drops below a readable floor', () => {
    expect(roomCharBudget(0)).toBe(6);
  });
});

describe('pillRoomLabel', () => {
  // Server allows room names up to 64 chars ([a-z0-9-]+).
  const long40 = 'a'.repeat(40);
  const long64 = 'b'.repeat(64);
  it('leaves short rooms intact', () => {
    expect(pillRoomLabel('default', pillSlotWidth(390))).toBe('# general');
  });
  it.each([
    [long40, 390],
    [long64, 390],
    [long64, 1024],
  ])('truncates %s within the slot budget (screen %p)', (room, screen) => {
    const slot = pillSlotWidth(screen);
    const out = pillRoomLabel(room, slot);
    expect(out.length).toBe(roomCharBudget(slot));
    expect(out.endsWith('…')).toBe(true);
    expect(out.startsWith('# ')).toBe(true);
  });
});
