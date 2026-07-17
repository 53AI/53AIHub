import { describe, expect, it } from "vitest";

import {
  OPENCLAW_HISTORY_FETCH_LIMIT,
  OPENCLAW_HISTORY_VISIBLE_STEP,
  getOpenClawHistoryVisibleCountForSelected,
  getOpenClawHistoryScrollAction,
  getVisibleOpenClawHistoryItems,
  shouldFetchOpenClawHistoryAfterShowMore,
} from "./openclaw-history";

describe("OpenClaw history pagination", () => {
  const conversations = Array.from({ length: 30 }, (_, index) => ({
    conversation_id: `session-${index + 1}`,
  }));

  it("loads 30 conversations but shows 10 at a time", () => {
    expect(OPENCLAW_HISTORY_FETCH_LIMIT).toBe(30);
    expect(OPENCLAW_HISTORY_VISIBLE_STEP).toBe(10);
    expect(getVisibleOpenClawHistoryItems(conversations, OPENCLAW_HISTORY_VISIBLE_STEP)).toHaveLength(10);
  });

  it("shows cached conversations before fetching another page", () => {
    expect(
      getOpenClawHistoryScrollAction({
        isNearBottom: true,
        loading: false,
        visibleCount: 10,
        cachedCount: 30,
        hasMoreRemote: true,
      }),
    ).toBe("show-more");
  });

  it("fetches another page only after cached conversations are visible", () => {
    expect(
      getOpenClawHistoryScrollAction({
        isNearBottom: true,
        loading: false,
        visibleCount: 30,
        cachedCount: 30,
        hasMoreRemote: true,
      }),
    ).toBe("fetch-more");
  });

  it("does nothing when the list is not near the bottom", () => {
    expect(
      getOpenClawHistoryScrollAction({
        isNearBottom: false,
        loading: false,
        visibleCount: 30,
        cachedCount: 30,
        hasMoreRemote: true,
      }),
    ).toBe("idle");
  });

  it("does nothing while a history page is already loading", () => {
    expect(
      getOpenClawHistoryScrollAction({
        isNearBottom: true,
        loading: true,
        visibleCount: 30,
        cachedCount: 30,
        hasMoreRemote: true,
      }),
    ).toBe("idle");
  });

  it("does not fetch when no remote history remains", () => {
    expect(
      getOpenClawHistoryScrollAction({
        isNearBottom: true,
        loading: false,
        visibleCount: 30,
        cachedCount: 30,
        hasMoreRemote: false,
      }),
    ).toBe("idle");
  });

  it("knows when showing cached items reaches the remote fetch boundary", () => {
    expect(
      shouldFetchOpenClawHistoryAfterShowMore({
        visibleCount: 20,
        cachedCount: 30,
        hasMoreRemote: true,
      }),
    ).toBe(true);

    expect(
      shouldFetchOpenClawHistoryAfterShowMore({
        visibleCount: 10,
        cachedCount: 30,
        hasMoreRemote: true,
      }),
    ).toBe(false);
  });

  it("keeps the plugin order when showing more cached conversations", () => {
    const visible = conversations.slice(0, 10);
    const expanded = conversations.slice(0, 20);

    expect(getVisibleOpenClawHistoryItems(conversations, 10)).toEqual(visible);
    expect(getVisibleOpenClawHistoryItems(conversations, 20)).toEqual(expanded);
  });

  it("expands the visible window to include the selected conversation without reordering", () => {
    expect(
      getOpenClawHistoryVisibleCountForSelected(
        conversations,
        "session-20",
        (item) => item.conversation_id,
        10
      )
    ).toBe(20);

    const visible = getVisibleOpenClawHistoryItems(conversations, 20);
    expect(visible[0]).toEqual(conversations[0]);
    expect(visible[19]).toEqual(conversations[19]);

    expect(
      getOpenClawHistoryVisibleCountForSelected(
        conversations,
        "session-20",
        (item) => item.conversation_id,
        20
      )
    ).toBe(20);

    expect(
      getOpenClawHistoryVisibleCountForSelected(
        conversations,
        "missing",
        (item) => item.conversation_id,
        10
      )
    ).toBe(10);
  });

  it("keeps the current visible count when the selected conversation is already visible", () => {
    expect(
      getOpenClawHistoryVisibleCountForSelected(
        conversations,
        "session-3",
        (item) => item.conversation_id,
        10
      )
    ).toBe(10);
  });
});
