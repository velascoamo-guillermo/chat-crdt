import { forwardRef, type ComponentRef } from 'react';
import type { ScrollViewProps } from 'react-native';
import {
  KeyboardChatScrollView,
  type KeyboardChatScrollViewProps,
} from 'react-native-keyboard-controller';

type Props = ScrollViewProps & KeyboardChatScrollViewProps;
type Ref = ComponentRef<typeof KeyboardChatScrollView>;

// Adapts KeyboardChatScrollView to a virtualized list via `renderScrollComponent`.
// The scroll view is full-bleed to the bottom of the screen (the composer overlays
// it), so `offset` is 0: on keyboard open the content lifts by the full keyboard
// height, matching the sticky composer above it.
export const ChatScrollView = forwardRef<Ref, Props>(function ChatScrollView(
  { inverted, ...props },
  ref
) {
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
