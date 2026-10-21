import { forwardRef, useEffect, type ComponentRef } from 'react';
import { t11 } from '../debug/t11Trace';
import type { ScrollViewProps } from 'react-native';
import {
  KeyboardChatScrollView,
  type KeyboardChatScrollViewProps,
} from 'react-native-keyboard-controller';

type Props = ScrollViewProps & KeyboardChatScrollViewProps;
type Ref = ComponentRef<typeof KeyboardChatScrollView>;

// Adapts KeyboardChatScrollView to a virtualized list via `renderScrollComponent`.
// The scroll view is full-bleed to the bottom of the screen (the composer overlays
// it). `offset` defaults to 0 — on keyboard open the content lifts by the full
// keyboard height; the chat screen passes the bottom safe-area inset, which its
// list padding already covers.
export const ChatScrollView = forwardRef<Ref, Props>(function ChatScrollView(
  { inverted, ...props },
  ref
) {
  useEffect(() => {
    t11('ChatScrollView mount');
    return () => t11('ChatScrollView unmount');
  }, []);
  return (
    <KeyboardChatScrollView
      ref={ref}
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      keyboardDismissMode="interactive"
      offset={0}
      inverted={inverted}
      {...props}
    />
  );
});
