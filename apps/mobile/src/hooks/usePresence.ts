import { useState, useEffect } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { PresenceState } from '@chat-crdt/shared';

export function usePresence(awareness: Awareness | null) {
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);

  useEffect(() => {
    if (!awareness) return;

    const updatePresence = () => {
      const localId = awareness.clientID;
      const entries = Array.from(awareness.getStates().entries()) as [
        number,
        Partial<PresenceState>,
      ][];
      // Only real participants announce a username — filters out any relay/phantom state.
      const participants = entries.filter(([, s]) => typeof s.username === 'string');
      setOnlineCount(participants.length);
      setTypingUsers(
        participants
          // Exclude ourselves — never show "you are typing" for the local user.
          .filter(([id, s]) => id !== localId && s.isTyping === true)
          .map(([, s]) => s.username as string),
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
