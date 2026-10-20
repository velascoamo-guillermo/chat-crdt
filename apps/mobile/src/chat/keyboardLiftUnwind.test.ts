import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
// Pure helpers added by patches/react-native-keyboard-controller+1.22.4.patch.
// Fails to resolve if the patch is dropped (e.g. on a keyboard-controller bump).
import {
  getUnwoundScroll,
  getMissedLift,
  getClampFloor,
} from 'react-native-keyboard-controller/src/components/KeyboardChatScrollView/useChatKeyboard/unwind';

// A show whose lift the scroll view clamped: the real R1 drift trace. 3318.67
// was commanded while the 320-keyboard inset (286) was still applied, so
// UIScrollView stopped at content − viewport + 286 = 3961.67 − 956 + 286.
const clamped = {
  scroll: 3291.67,
  pendingOffset: 3318.67,
  clampFloor: 3291.67,
  opening: true,
  userDragged: false,
  inverted: false,
};

describe('getClampFloor (furthest offset before the new inset lands)', () => {
  it('is content − viewport + the inset in effect (R1 drift and one-page-room traces)', () => {
    expect(getClampFloor({ contentHeight: 3961.67, layoutHeight: 956, inset: 286, inverted: false })).toBeCloseTo(3291.67);
    expect(getClampFloor({ contentHeight: 1093, layoutHeight: 956, inset: 0, inverted: false })).toBe(137);
  });
  it('never goes below 0 for content shorter than the viewport', () => {
    expect(getClampFloor({ contentHeight: 600, layoutHeight: 956, inset: 0, inverted: false })).toBe(0);
  });
  it('is the negative top inset for an inverted list', () => {
    expect(getClampFloor({ contentHeight: 3000, layoutHeight: 956, inset: 286, inverted: true })).toBe(-286);
  });
});

describe('getMissedLift (iOS keyboard lift clamped before its inset landed)', () => {
  it('returns the commanded offset when the scroll view rests clamped at the old range', () => {
    expect(getMissedLift(clamped)).toBe(3318.67);
  });
  it('re-applies the one-page room lift that never moved (finding 4 trace: 137 → 450)', () => {
    expect(getMissedLift({ ...clamped, scroll: 137, pendingOffset: 450, clampFloor: 137 })).toBe(450);
  });
  it('leaves a user drag during the show alone, even if it ends near the floor', () => {
    expect(getMissedLift({ ...clamped, userDragged: true })).toBeNull();
  });
  it('leaves a scroll short of the lift alone when it is not resting at the clamp floor', () => {
    // Moved by something other than the clamp (a drag whose begin was missed, a fling).
    expect(getMissedLift({ ...clamped, scroll: 2600 })).toBeNull();
  });
  it('never re-applies on a keyboard hide: a shrinking inset cannot clamp a hide short', () => {
    expect(getMissedLift({ ...clamped, opening: false })).toBeNull();
  });
  it('leaves a scroll past the lift alone: the composer end-scroll (pill→card) moved it on purpose', () => {
    // Real trace: lift 3280.67, then the card's growth scrolled to 3318.67.
    expect(getMissedLift({ ...clamped, scroll: 3318.67, pendingOffset: 3280.67, clampFloor: 3318.67 })).toBeNull();
  });
  it('returns null when the lift landed (sub-pixel rounding included)', () => {
    expect(getMissedLift({ ...clamped, scroll: 3318.5, clampFloor: 3318.5 })).toBeNull();
  });
  it('returns null when no lift is pending', () => {
    expect(getMissedLift({ ...clamped, pendingOffset: null })).toBeNull();
  });
  it('treats an inverted list as clamped when it stopped above the (negative) lift', () => {
    const inv = { ...clamped, inverted: true, pendingOffset: -313, clampFloor: -286 };
    expect(getMissedLift({ ...inv, scroll: -286 })).toBe(-313);
    expect(getMissedLift({ ...inv, scroll: -340 })).toBeNull();
  });
});

// The helpers above are only correct if the hook feeds them. A source-level
// guard: it can't prove runtime behaviour (device evidence does), but it fails
// if a kbc bump or a patch edit drops one of the wires.
describe('useChatKeyboard (iOS) wiring of the lift helpers', () => {
  const hook = readFileSync(
    require.resolve(
      'react-native-keyboard-controller/src/components/KeyboardChatScrollView/useChatKeyboard/index.ios.ts',
    ),
    'utf8',
  );
  const scrollState = readFileSync(
    require.resolve('react-native-keyboard-controller/src/components/hooks/useScrollState.ts'),
    'utf8',
  );
  it('unwinds from the pending offset taken at the start of onStart', () => {
    expect(hook).toMatch(/const prevPending = pendingOffset\.value;\s*pendingOffset\.value = null;/);
    expect(hook).toMatch(/getUnwoundScroll\(\{[^}]*pendingOffset: prevPending/);
  });
  it('records the commanded lift, its clamp floor and the drag count only on the shift path', () => {
    expect(hook).toMatch(/pendingOffset\.value = contentOffsetY\.value;/);
    expect(hook).toMatch(/clampFloor\.value = getClampFloor\(/);
    expect(hook).toMatch(/dragsAtStart\.value = drags\.value;/);
  });
  it('re-applies only through getMissedLift, after the freeze check, on the next frame', () => {
    const onEnd = hook.slice(hook.indexOf('onEnd:'));
    expect(onEnd.indexOf('freeze.value')).toBeLessThan(onEnd.indexOf('getMissedLift('));
    expect(onEnd).toMatch(/userDragged: drags\.value !== dragsAtStart\.value/);
    expect(onEnd).toMatch(/requestAnimationFrame\(\(\) => \{\s*scrollTo\(scrollViewRef, 0, missed, false\);/);
  });
  it('counts user drags from the native onScrollBeginDrag event', () => {
    expect(scrollState).toMatch(/event\.eventName\.endsWith\("onScrollBeginDrag"\)/);
    expect(scrollState).toMatch(/drags\.value \+= 1;/);
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
