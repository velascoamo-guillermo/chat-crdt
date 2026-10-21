// TEMPORARY T11 trace (iOS typing jump). Remove before merge.
const t0 = Date.now();
export const t11 = (tag: string, data?: Record<string, unknown>): void => {
  console.log(`[T11] +${Date.now() - t0}ms ${tag}${data ? ` ${JSON.stringify(data)}` : ''}`);
};
