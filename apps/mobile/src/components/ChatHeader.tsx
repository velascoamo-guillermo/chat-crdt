import { memo } from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { darkTheme as theme, statusColor } from '../ui';

// Account action for the native header's right slot — SF Symbol on a liquid
// glass disc. Opens the account formSheet (email + logout).
export const HeaderAccount = memo(function HeaderAccount({
  onPress,
}: {
  onPress: () => void;
}) {
  const icon = (
    <SymbolView
      name="person.crop.circle.fill"
      size={28}
      weight="semibold"
      tintColor={theme.textPrimary}
    />
  );

  if (!isLiquidGlassAvailable()) {
    return (
      <Pressable onPress={onPress} hitSlop={12} style={[styles.disc, styles.discFallback]}>
        {icon}
      </Pressable>
    );
  }

  return (
    <GlassView glassEffectStyle="regular" style={styles.disc} isInteractive>
      <Pressable onPress={onPress} hitSlop={12} style={styles.discPress}>
        {icon}
      </Pressable>
    </GlassView>
  );
});

// Presence indicator for the native header's right slot — a liquid glass pill.
export const OnlinePill = memo(function OnlinePill({
  wsStatus,
  onlineCount,
}: {
  wsStatus: string;
  onlineCount: number;
}) {
  const content = (
    <>
      <View style={[styles.dot, { backgroundColor: statusColor(wsStatus) }]} />
      <Text style={styles.label}>{`${onlineCount} online`}</Text>
    </>
  );

  if (!isLiquidGlassAvailable()) {
    return <View style={[styles.pill, styles.pillFallback]}>{content}</View>;
  }

  return (
    <GlassView glassEffectStyle="regular" style={styles.pill}>
      {content}
    </GlassView>
  );
});

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    overflow: 'hidden',
  },
  pillFallback: { backgroundColor: theme.surface },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 13, fontWeight: '500', color: theme.textPrimary },
  disc: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: 'hidden',
  },
  discPress: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  discFallback: {
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
