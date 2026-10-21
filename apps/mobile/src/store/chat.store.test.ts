import { describe, it, expect, beforeEach } from 'bun:test';
import { useChatStore } from './chat.store';

describe('chat.store E2EE rejection lifecycle (T10)', () => {
  beforeEach(() => useChatStore.setState({ e2eeRejectionByRoom: {}, mountCounts: {} }));

  it('records a rejection with a fresh seq each time', () => {
    const { noteE2eeRejection } = useChatStore.getState();
    noteE2eeRejection('team-a', 'one');
    const first = useChatStore.getState().e2eeRejectionByRoom['team-a']!;
    noteE2eeRejection('team-a', 'two');
    const second = useChatStore.getState().e2eeRejectionByRoom['team-a']!;

    expect(second.text).toBe('two');
    expect(second.seq).toBeGreaterThan(first.seq);
  });

  it('records a resync notice distinctly from a restored draft', () => {
    useChatStore.getState().noteE2eeRejection('team-a', '', 'resynced');
    expect(useChatStore.getState().e2eeRejectionByRoom['team-a']).toMatchObject({ text: '', kind: 'resynced' });
  });

  it("survives clearRoom (it is the user's unsent text, not room data)", () => {
    const s = useChatStore.getState();
    s.registerMount('team-a');
    s.noteE2eeRejection('team-a', 'keep me');
    s.clearRoom('team-a');
    expect(useChatStore.getState().e2eeRejectionByRoom['team-a']?.text).toBe('keep me');
  });

  it('clearE2eeRejection removes it (next successful send)', () => {
    useChatStore.getState().noteE2eeRejection('team-a', 'x');
    useChatStore.getState().clearE2eeRejection('team-a');
    expect(useChatStore.getState().e2eeRejectionByRoom['team-a']).toBeUndefined();
  });

  it('clearAllE2eeRejections wipes every room (logout: the next account must not get it)', () => {
    useChatStore.getState().noteE2eeRejection('team-a', 'a');
    useChatStore.getState().noteE2eeRejection('team-b', 'b');
    useChatStore.getState().clearAllE2eeRejections();
    expect(useChatStore.getState().e2eeRejectionByRoom).toEqual({});
  });
});
