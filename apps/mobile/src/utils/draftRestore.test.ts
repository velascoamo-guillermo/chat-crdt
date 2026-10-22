import { describe, it, expect } from 'bun:test';
import { applyDraftRestore, draftAfterRestore } from './draftRestore';

// T10: Composer puts refused text back into the draft once per rejection.
describe('draftAfterRestore', () => {
  it('fills an empty draft', () => {
    expect(draftAfterRestore('', { text: 'hello', seq: 1 }, null)).toEqual({ draft: 'hello', seq: 1 });
  });

  it('appends to what the user is already typing, on a new line', () => {
    expect(draftAfterRestore('typing ', { text: 'hello', seq: 1 }, null)).toEqual({
      draft: 'typing\nhello',
      seq: 1,
    });
  });

  it('applies each rejection only once', () => {
    expect(draftAfterRestore('hello', { text: 'hello', seq: 1 }, 1)).toBeNull();
  });

  it('marks an empty restore as seen without touching the draft', () => {
    expect(draftAfterRestore('typing', { text: '', seq: 2 }, 1)).toEqual({ draft: 'typing', seq: 2 });
  });

  it('nothing to restore -> no change', () => {
    expect(draftAfterRestore('typing', undefined, null)).toBeNull();
  });
});

// M1: the redesigned Composer derives Send/card state from `hasText`, which
// only onChangeText updates — a programmatic restore must flip it too.
describe('applyDraftRestore', () => {
  function fakeComposer(initial = '') {
    const state = { draft: initial, hasText: initial.trim().length > 0, hasTextFlips: [] as boolean[] };
    const target = {
      getDraft: () => state.draft,
      setDraft: (value: string) => {
        state.draft = value;
      },
      hasText: () => state.hasText,
      setHasText: (active: boolean) => {
        state.hasText = active;
        state.hasTextFlips.push(active);
      },
    };
    return { state, target };
  }

  it('restoring into an empty composer sets hasText (enables Send, opens the card)', () => {
    const { state, target } = fakeComposer();
    expect(applyDraftRestore(target, { text: 'hello', seq: 1 }, null)).toBe(1);
    expect(state.draft).toBe('hello');
    expect(state.hasText).toBe(true);
    expect(state.hasTextFlips).toEqual([true]);
  });

  it('does not re-flip hasText when the user was already typing', () => {
    const { state, target } = fakeComposer('typing');
    expect(applyDraftRestore(target, { text: 'hello', seq: 1 }, null)).toBe(1);
    expect(state.draft).toBe('typing\nhello');
    expect(state.hasTextFlips).toEqual([]);
  });

  it('an empty restore only marks the seq seen', () => {
    const { state, target } = fakeComposer();
    expect(applyDraftRestore(target, { text: '', seq: 2 }, 1)).toBe(2);
    expect(state.draft).toBe('');
    expect(state.hasTextFlips).toEqual([]);
  });

  it('an already-applied restore is a no-op', () => {
    const { state, target } = fakeComposer();
    expect(applyDraftRestore(target, { text: 'hello', seq: 1 }, 1)).toBeNull();
    expect(state.draft).toBe('');
    expect(state.hasTextFlips).toEqual([]);
  });
});
