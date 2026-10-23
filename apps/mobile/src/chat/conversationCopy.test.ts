import { describe, it, expect } from 'bun:test';
import { greeting, typingLabel, typingPeers } from './conversationCopy';

describe('greeting', () => {
  it('greets the user by name', () => {
    expect(greeting('ana')).toBe('Welcome back, ana');
  });
  it('trims the name', () => {
    expect(greeting('  ana ')).toBe('Welcome back, ana');
  });
  it('falls back without a name', () => {
    expect(greeting(undefined)).toBe('Welcome back');
  });
  it('falls back on a blank name', () => {
    expect(greeting('   ')).toBe('Welcome back');
  });
});

describe('typingLabel', () => {
  it('is empty when nobody types (component renders null)', () => {
    expect(typingLabel([])).toBe('');
  });
  it('1 user', () => {
    expect(typingLabel(['ana'])).toBe('ana is typing…');
  });
  it('2 users', () => {
    expect(typingLabel(['ana', 'bo'])).toBe('ana and bo are typing…');
  });
  it('3 users', () => {
    expect(typingLabel(['ana', 'bo', 'cy'])).toBe('ana, bo and 1 other are typing…');
  });
  it('4+ users', () => {
    expect(typingLabel(['ana', 'bo', 'cy', 'di'])).toBe('ana, bo and 2 others are typing…');
  });
});

describe('typingPeers', () => {
  const states = new Map<number, Record<string, unknown>>([
    [1, { username: 'me', isTyping: true }],
    [2, { username: 'ana', isTyping: true }],
    [3, { username: 'bo', isTyping: false }],
    [4, { isTyping: true }],
    [5, { username: 'cy', isTyping: true }],
  ]);

  it('excludes the local client, idle peers and nameless states', () => {
    expect(typingPeers(states, 1)).toEqual(['ana', 'cy']);
  });
  it('excludes the local username on another client of the same user', () => {
    const twoTabs = new Map(states).set(6, { username: 'me', isTyping: true });
    expect(typingPeers(twoTabs, 1, 'me')).toEqual(['ana', 'cy']);
  });
  it('dedupes a peer typing from two clients', () => {
    const dup = new Map(states).set(7, { username: 'ana', isTyping: true });
    expect(typingPeers(dup, 1)).toEqual(['ana', 'cy']);
  });
});
