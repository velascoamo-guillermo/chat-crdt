import type { IdentityStatus } from '../crypto/keyFlows';

// T15 fix 2 (owner policy a): what the identity-mismatch banner says and does.
// Kept free of React/native imports so it runs under bun test.

export const IDENTITY_BANNER_COPY = {
  title: "This device's encryption key is out of date",
  body: "Messages in encrypted rooms can't be read here.",
  action: "Reset this device's key",
  resetting: 'Resetting…',
  failed: "Couldn't reset the key. Check your connection and try again.",
  confirmTitle: "Reset this device's key?",
  confirmBody:
    'This device gets a new key, and room members are asked to share encrypted history with it again. Your other device will lose access to encrypted history.',
  confirmAction: 'Reset key',
  cancel: 'Cancel',
} as const;

/** Only a mismatch needs the user: every other status already settled itself. */
export function showIdentityBanner(status: IdentityStatus | null): boolean {
  return status === 'mismatch';
}

export type ResetOutcome = 'cancelled' | 'done' | 'failed';

interface ResetDeps {
  /** Resolves true when the user confirmed the destructive dialog. */
  confirm: () => Promise<boolean>;
  /** The store's reset action; it records the new status rather than returning it. */
  reset: () => Promise<void>;
  getStatus: () => IdentityStatus | null;
}

export async function resetDeviceKeyFlow(deps: ResetDeps): Promise<ResetOutcome> {
  if (!(await deps.confirm())) return 'cancelled';
  try {
    await deps.reset();
  } catch {
    return 'failed';
  }
  return showIdentityBanner(deps.getStatus()) ? 'failed' : 'done';
}
