import { useState, useEffect } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { PresenceState } from '@chat-crdt/shared';

export function usePresence(awareness: Awareness | null) {
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);

  useEffect(() => {
    if (!awareness) return;

    const updatePresence = () => {
      const states = Array.from(awareness.getStates().values()) as Partial<PresenceState>[];
      setOnlineCount(states.length);
      setTypingUsers(
        states
          .filter(s => s.isTyping === true && typeof s.username === 'string')
          .map(s => s.username as string),
      );
    };

    awareness.on('change', updatePresence);
    updatePresence(); // initialize from current state

    return () => {
      awareness.off('change', updatePresence);
    };
  }, [awareness]);

  return { typingUsers, onlineCount };
}
