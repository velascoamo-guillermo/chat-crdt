import { describe, it, expect } from 'bun:test';
// Pure helper added by patches/react-native-keyboard-controller+1.22.4.patch.
// Fails to resolve if the patch is dropped (e.g. on a keyboard-controller bump).
import {
  getUnwoundScroll,
  getMissedLift,
} from 'react-native-keyboard-controller/src/components/KeyboardChatScrollView/useChatKeyboard/unwind';

describe('getMissedLift (iOS keyboard lift clamped before its inset landed)', () => {
  it('returns the commanded offset when the scroll view clamped short of it', () => {
    // Real trace: 3318.67 commanded while the 320-keyboard inset was still
    // applied, so UIScrollView stopped at content − viewport + 286 = 3291.67.
    expect(getMissedLift({ scroll: 3291.67, pendingOffset: 3318.67, inverted: false })).toBe(3318.67);
  });
  it('leaves a scroll past the lift alone: the composer end-scroll (pill→card) moved it on purpose', () => {
    // Real trace: lift 3280.67, then the card's growth scrolled to 3318.67.
    expect(getMissedLift({ scroll: 3318.67, pendingOffset: 3280.67, inverted: false })).toBeNull();
  });
  it('returns null when the lift landed (sub-pixel rounding included)', () => {
    expect(getMissedLift({ scroll: 3318.5, pendingOffset: 3318.67, inverted: false })).toBeNull();
  });
  it('returns null when no lift is pending', () => {
    expect(getMissedLift({ scroll: 3291.67, pendingOffset: null, inverted: false })).toBeNull();
  });
  it('treats an inverted list as clamped when it stopped above the (negative) lift', () => {
    expect(getMissedLift({ scroll: -286, pendingOffset: -313, inverted: true })).toBe(-313);
    expect(getMissedLift({ scroll: -340, pendingOffset: -313, inverted: true })).toBeNull();
  });
});

describe('getUnwoundScroll (iOS keyboard lift, back-to-back keyboard shows)', () => {
  it('unwinds the previous shift from the offset it commanded while that scroll has not landed yet', () => {
    // Real trace, account sheet dismissed with the composer focused: the
    // keyboard comes back as 320 then 347 with no onEnd in between. The first
    // shift commanded 3291.67 but scroll still reads 3005.67.
    expect(
      getUnwoundScroll({ scroll: 3005.67, pendingOffset: 3291.67, prevScrollEffective: 286, inverted: false }),
    ).toBeCloseTo(3005.67);
  });
  it('unwinds from the live scroll offset when no shift is pending', () => {
    expect(
      getUnwoundScroll({ scroll: 3318.67, pendingOffset: null, prevScrollEffective: 313, inverted: false }),
    ).toBeCloseTo(3005.67);
  });
  it('adds the previous shift back for an inverted list', () => {
    expect(
      getUnwoundScroll({ scroll: -40, pendingOffset: -326, prevScrollEffective: 286, inverted: true }),
    ).toBeCloseTo(-40);
  });
});
