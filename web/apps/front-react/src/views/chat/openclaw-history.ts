export const OPENCLAW_HISTORY_FETCH_LIMIT = 30;
export const OPENCLAW_HISTORY_VISIBLE_STEP = 10;

export type OpenClawHistoryScrollAction = "idle" | "show-more" | "fetch-more";

export function getVisibleOpenClawHistoryItems<T>(items: T[], visibleCount: number): T[] {
  return items.slice(0, Math.max(0, visibleCount));
}

export function getOpenClawHistoryVisibleCountForSelected<T>(
  items: T[],
  selectedId: string | number | undefined | null,
  getId: (item: T) => string | number | undefined | null,
  visibleCount: number
): number {
  if (!selectedId || selectedId === 0 || selectedId === "0") return visibleCount;

  const selectedKey = String(selectedId);
  const selectedIndex = items.findIndex((item) => String(getId(item) || "") === selectedKey);
  if (selectedIndex < 0) return visibleCount;

  return Math.min(
    Math.max(visibleCount, Math.ceil((selectedIndex + 1) / OPENCLAW_HISTORY_VISIBLE_STEP) * OPENCLAW_HISTORY_VISIBLE_STEP),
    items.length
  );
}

export function getNextOpenClawHistoryVisibleCount(visibleCount: number, cachedCount: number): number {
  return Math.min(visibleCount + OPENCLAW_HISTORY_VISIBLE_STEP, cachedCount);
}

export function shouldFetchOpenClawHistoryAfterShowMore({
  visibleCount,
  cachedCount,
  hasMoreRemote,
}: {
  visibleCount: number;
  cachedCount: number;
  hasMoreRemote: boolean;
}): boolean {
  if (!hasMoreRemote) return false;
  return getNextOpenClawHistoryVisibleCount(visibleCount, cachedCount) >= cachedCount;
}

export function getOpenClawHistoryScrollAction({
  isNearBottom,
  loading,
  visibleCount,
  cachedCount,
  hasMoreRemote,
}: {
  isNearBottom: boolean;
  loading: boolean;
  visibleCount: number;
  cachedCount: number;
  hasMoreRemote: boolean;
}): OpenClawHistoryScrollAction {
  if (!isNearBottom || loading) return "idle";
  if (visibleCount < cachedCount) return "show-more";
  if (hasMoreRemote) return "fetch-more";
  return "idle";
}
