import { describe, expect, it } from "vitest";

import {
  isOpenClawConversationId,
  shouldUseOpenClawChatAdapter,
} from "@km/shared-business/chat";

describe("OpenClaw route detection", () => {
  it("recognizes Codex agenthub conversation ids as OpenClaw sessions", () => {
    expect(isOpenClawConversationId("agenthub_u1")).toBe(true);
    expect(isOpenClawConversationId("agenthub-u1")).toBe(true);
    expect(isOpenClawConversationId("agent:main:dashboard:current")).toBe(true);
    expect(isOpenClawConversationId("12345")).toBe(false);
  });

  it("keeps the OpenClaw adapter while the route agent is still loading", () => {
    expect(
      shouldUseOpenClawChatAdapter({
        currentAgent: undefined,
        agentId: "16",
        openClawChannelType: 1014,
        routeType: "openclaw",
        conversationId: "agenthub_u1",
      })
    ).toBe(true);
  });

  it("does not keep stale OpenClaw mode after a non-OpenClaw route agent resolves", () => {
    expect(
      shouldUseOpenClawChatAdapter({
        currentAgent: {
          agent_id: "16",
          channel_type: 1,
        },
        agentId: "16",
        openClawChannelType: 1014,
        routeType: "openclaw",
        conversationId: "agenthub_u1",
      })
    ).toBe(false);
  });
});
