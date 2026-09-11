export type DialogFocusLoopTarget = "first" | "last" | null;

export function resolveDialogFocusLoopTarget({
  activeIndex,
  focusableCount,
  shiftKey,
}: {
  activeIndex: number;
  focusableCount: number;
  shiftKey: boolean;
}): DialogFocusLoopTarget {
  if (focusableCount <= 0) return null;
  if (shiftKey && activeIndex <= 0) return "last";
  if (!shiftKey && (activeIndex < 0 || activeIndex >= focusableCount - 1)) return "first";
  return null;
}
