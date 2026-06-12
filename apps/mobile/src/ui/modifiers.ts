import { Platform } from 'react-native';
import {
  frame,
  padding,
  background,
  buttonStyle,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { weight } from '@expo/ui/jetpack-compose/modifiers';
import { theme } from './theme';

// Make a Row/Column child expand to fill available main-axis space.
export function grow() {
  return Platform.OS === 'android' ? [weight(1)] : [frame({ maxWidth: Infinity })];
}

// Pill-shaped text field: padded content on a capsule surface background.
export function pillInput() {
  if (Platform.OS === 'android') return [];
  return [
    padding({ horizontal: 16, vertical: 10 }),
    background(theme.surface, shapes.capsule()),
  ];
}

// Circular icon button filled with the accent color.
export function circleButton(size = 36) {
  if (Platform.OS === 'android') return [];
  return [
    buttonStyle('plain'),
    frame({ width: size, height: size }),
    background(theme.accent, shapes.circle()),
  ];
}
