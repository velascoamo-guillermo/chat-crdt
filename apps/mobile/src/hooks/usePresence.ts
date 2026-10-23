import { useState, useEffect } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { typingPeers } from '../chat/conversationCopy';

// `selfUsername` keeps the local user out of the typing list on their other devices too.
export function usePresence(awareness: Awareness | null, selfUsername?: string) {
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);

  useEffect(() => {
    if (!awareness) return;

    const updatePresence = () => {
      const states = awareness.getStates() as Map<number, Record<string, unknown>>;
      setOnlineCount(states.size);
      setTypingUsers(typingPeers(states, awareness.clientID, selfUsername));
    };

    awareness.on('change', updatePresence);
    updatePresence(); // initialize from current state

    return () => {
      awareness.off('change', updatePresence);
    };
  }, [awareness, selfUsername]);

  return { typingUsers, onlineCount };
}
