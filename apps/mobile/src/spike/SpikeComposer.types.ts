// T6 spike — throwaway, never merged.
export type SpikeComposerProps = {
  /** Show the 🔒 Encrypted chip in the card toolbar row. */
  e2ee: boolean;
  /** Animate the pill↔card change (false = jump cut, for comparison). */
  animated: boolean;
  /** Fires on every native TextField mount (remount detector). */
  onFieldMount: () => void;
  onSend: (text: string) => void;
};
