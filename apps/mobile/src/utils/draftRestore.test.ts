import { describe, it, expect } from 'bun:test';
import { draftAfterRestore } from './draftRestore';

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
