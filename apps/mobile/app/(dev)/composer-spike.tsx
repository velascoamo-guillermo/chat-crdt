// T6 spike — throwaway route, never merged. Open via chatcrdt://composer-spike
// Mirrors the real chat screen's keyboard setup ([roomId].tsx): FlatList with
// paddingBottom = measured composer height, composer in KeyboardStickyView,
// whole screen in KeyboardGestureArea (interactive dismiss).
import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { KeyboardGestureArea, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SpikeComposer } from "../../src/spike/SpikeComposer";

const ROWS = Array.from({ length: 40 }, (_, i) => `row ${i + 1}`);

export default function ComposerSpike() {
  const { top, bottom } = useSafeAreaInsets();
  const [rows, setRows] = useState<string[]>(ROWS);
  const [composerH, setComposerH] = useState(0);
  const [e2ee, setE2ee] = useState(true);
  const [animated, setAnimated] = useState(true);
  const [fieldMounts, setFieldMounts] = useState(0);
  // Every RN layout pass of the composer wrapper. Many distinct heights during
  // one morph = Host frame follows the native animation; one jump = snap.
  const heights = useRef<number[]>([]);
  const [layoutLog, setLayoutLog] = useState("");

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    heights.current = [...heights.current, h].slice(-12);
    setComposerH(h);
    setLayoutLog(heights.current.join(" "));
  }, []);

  const onFieldMount = useCallback(() => setFieldMounts((n) => n + 1), []);
  const onSend = useCallback((t: string) => setRows((r) => [...r, t]), []);
  const data = useMemo(() => [...rows].reverse(), [rows]);

  return (
    <KeyboardGestureArea interpolator="ios" style={[styles.flex, { backgroundColor: "#0A0A0A" }]}>
      <View style={[styles.hud, { paddingTop: top + 4 }]}>
        <Text testID="spike-hud" style={styles.hudText}>
          {`fieldMounts=${fieldMounts}  composerH=${composerH}\nlayouts: ${layoutLog}`}
        </Text>
        <View style={styles.hudRow}>
          <Pressable testID="spike-toggle-anim" onPress={() => setAnimated((a) => !a)} style={styles.hudBtn}>
            <Text style={styles.hudText}>{animated ? "anim ON" : "anim OFF"}</Text>
          </Pressable>
          <Pressable testID="spike-toggle-e2ee" onPress={() => setE2ee((v) => !v)} style={styles.hudBtn}>
            <Text style={styles.hudText}>{e2ee ? "e2ee ON" : "e2ee OFF"}</Text>
          </Pressable>
          <Pressable testID="spike-reset-log" onPress={() => { heights.current = []; setLayoutLog(""); }} style={styles.hudBtn}>
            <Text style={styles.hudText}>clear log</Text>
          </Pressable>
        </View>
      </View>
      <FlatList
        style={styles.flex}
        inverted
        data={data}
        keyExtractor={(item, i) => `${i}-${item}`}
        keyboardDismissMode="interactive"
        contentContainerStyle={{ paddingTop: composerH + 12 }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowText}>{item}</Text>
          </View>
        )}
      />
      <KeyboardStickyView style={styles.sticky} offset={{ closed: -bottom, opened: -8 }}>
        <View onLayout={onLayout}>
          <SpikeComposer e2ee={e2ee} animated={animated} onFieldMount={onFieldMount} onSend={onSend} />
        </View>
      </KeyboardStickyView>
    </KeyboardGestureArea>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hud: { paddingHorizontal: 12, paddingBottom: 6, backgroundColor: "#151515" },
  hudRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  hudBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: "#333" },
  hudText: { color: "#9f9", fontFamily: "Menlo", fontSize: 11 },
  row: { marginHorizontal: 16, marginVertical: 4, padding: 12, borderRadius: 14, backgroundColor: "#1C1C1E" },
  rowText: { color: "#ddd" },
  sticky: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
