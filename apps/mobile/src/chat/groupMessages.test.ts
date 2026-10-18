import { describe, it, expect } from 'bun:test';
import type { MessageDto } from '@chat-crdt/shared';
import { groupPosition, GROUP_GAP_MS } from './groupMessages';
import {
  ME,
  MINUTE,
  sameAuthorRun,
  authorSwitch,
  gapBreak,
  ownRun,
  singleMessage,
} from './__fixtures__/messages';

function positions(list: readonly MessageDto[], me: string | undefined) {
  return list.map((m, i) => groupPosition(list[i - 1], m, list[i + 1], GROUP_GAP_MS, me));
}

describe('groupPosition', () => {
  it('uses a ~5 minute default gap', () => {
    expect(GROUP_GAP_MS).toBe(5 * MINUTE);
  });

  it('first message of a list shows the author and starts a group', () => {
    const [p] = positions(singleMessage, ME);
    expect(p).toEqual({ showAuthor: true, isFirst: true, isLast: true });
  });

  it('same author consecutive: name only on the first, isLast only on the last', () => {
    expect(positions(sameAuthorRun, ME)).toEqual([
      { showAuthor: true, isFirst: true, isLast: false },
      { showAuthor: false, isFirst: false, isLast: false },
      { showAuthor: false, isFirst: false, isLast: true },
    ]);
  });

  it('author switch starts a new group and ends the previous one', () => {
    expect(positions(authorSwitch, ME)).toEqual([
      { showAuthor: true, isFirst: true, isLast: false }, // alice
      { showAuthor: false, isFirst: false, isLast: true }, // alice, before switch
      { showAuthor: true, isFirst: true, isLast: false }, // bob
      { showAuthor: false, isFirst: false, isLast: true }, // bob, before switch
      { showAuthor: true, isFirst: true, isLast: true }, // alice again, end of list
    ]);
  });

  it('same author past the gap threshold breaks the group', () => {
    expect(positions(gapBreak, ME)).toEqual([
      { showAuthor: true, isFirst: true, isLast: false },
      { showAuthor: false, isFirst: false, isLast: true }, // next is > 5 min later
      { showAuthor: true, isFirst: true, isLast: false }, // gap break → name again
      { showAuthor: false, isFirst: false, isLast: true },
    ]);
  });

  it('a gap exactly at the threshold does not break the group', () => {
    const [a, b] = sameAuthorRun;
    const atLimit = { ...b, createdAt: a.createdAt + GROUP_GAP_MS };
    expect(groupPosition(a, atLimit, undefined, GROUP_GAP_MS, ME).isFirst).toBe(false);
  });

  it('own messages never show the author but still group correctly', () => {
    expect(positions(ownRun, ME)).toEqual([
      { showAuthor: false, isFirst: true, isLast: false }, // me
      { showAuthor: false, isFirst: false, isLast: true }, // me, before alice
      { showAuthor: true, isFirst: true, isLast: true }, // alice
      { showAuthor: false, isFirst: true, isLast: true }, // me, end
    ]);
  });

  it('without a known own id, every group shows its author', () => {
    expect(positions(ownRun, undefined).map((p) => p.showAuthor)).toEqual([true, false, true, true]);
  });
});
