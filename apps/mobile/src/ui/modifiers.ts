import { Platform } from 'react-native';
import { frame } from '@expo/ui/swift-ui/modifiers';
import { weight } from '@expo/ui/jetpack-compose/modifiers';

// Make a Row/Column child expand to fill available main-axis space.
export function grow() {
  return Platform.OS === 'android' ? [weight(1)] : [frame({ maxWidth: Infinity })];
}
