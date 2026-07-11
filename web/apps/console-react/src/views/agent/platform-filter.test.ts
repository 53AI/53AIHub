import { describe, expect, it } from "vitest";

import {
  AGENT_USAGE_PLATFORM_VALUES,
  buildAgentListParams,
  createAgentPlatformFilterOptions,
  resolveAgentPlatformFilter,
} from "./platform-filter";

describe("agent platform filter", () => {
  it("sends OpenClaw compatible platform values through channel_types", () => {
    expect(resolveAgentPlatformFilter("openclaw")).toEqual({ channel_types: "1014" });
    expect(resolveAgentPlatformFilter("qclaw")).toEqual({ channel_types: "1015" });
    expect(resolveAgentPlatformFilter("codex")).toEqual({ channel_types: "1016" });
    expect(resolveAgentPlatformFilter("manus")).toEqual({ channel_types: "1017" });
  });

  it("keeps regular platform values on channel_types", () => {
    expect(resolveAgentPlatformFilter("22")).toEqual({ channel_types: "22" });
    expect(resolveAgentPlatformFilter("1,3,44,36")).toEqual({ channel_types: "1,3,44,36" });
  });

  it("routes AI搜问 / 小助理 through agent_usages instead of channel_types", () => {
    expect(resolveAgentPlatformFilter(AGENT_USAGE_PLATFORM_VALUES.KM_AI_SEARCH)).toEqual({
      agent_usages: "1",
    });
    expect(resolveAgentPlatformFilter(AGENT_USAGE_PLATFORM_VALUES.WORK_AI)).toEqual({
      agent_usages: "4",
    });
  });

  it("builds list params with channel_types for QClaw", () => {
    expect(
      buildAgentListParams({
        group_id: [12],
      platform: "1015",
        type: "2",
        keyword: "demo",
        page: 3,
        page_size: 20,
      }),
    ).toEqual({
      group_id: "12",
      channel_types: "1015",
      agent_types: "2",
      keyword: "demo",
      offset: 40,
      limit: 20,
    });
  });

  it("builds list params with agent_usages for 小助理", () => {
    expect(
      buildAgentListParams({
        group_id: 12,
        platform: AGENT_USAGE_PLATFORM_VALUES.WORK_AI,
        type: "",
        keyword: "",
        page: 1,
        page_size: 10,
      }),
    ).toEqual({
      group_id: "12",
      agent_usages: "4",
      agent_types: "",
      keyword: "",
      offset: 0,
      limit: 10,
    });
  });

  it("builds list params with agent_usages for AI搜问", () => {
    expect(
      buildAgentListParams({
        group_id: 12,
        platform: AGENT_USAGE_PLATFORM_VALUES.KM_AI_SEARCH,
        type: "",
        keyword: "",
        page: 1,
        page_size: 10,
      }),
    ).toEqual({
      group_id: "12",
      agent_usages: "1",
      agent_types: "",
      keyword: "",
      offset: 0,
      limit: 10,
    });
  });

  it("expands currently exposed OpenClaw compatible entries into independent platform options", () => {
    const options = createAgentPlatformFilterOptions(
      [
        { label: "Prompt", channelType: 0 },
        { label: "OpenClaw", channelType: 1014 },
        { label: "FastGPT", channelType: 22 },
      ],
      [
        { label: "OpenClaw", value: "openclaw", icon: "", channel_type: 1014, agent_type: 2, agent_mode: "assistant" },
        { label: "QClaw", value: "qclaw", icon: "", channel_type: 1015, agent_type: 2, agent_mode: "assistant" },
      ],
    );

    expect(options).toEqual([
      { label: "Prompt", value: "1,3,44,36" },
      { label: "FastGPT", value: "22" },
      { label: "OpenClaw", value: "1014" },
      { label: "QClaw", value: "1015" },
    ]);
  });

  it("appends extra options (AI搜问 / 小助理) at the end", () => {
    const options = createAgentPlatformFilterOptions(
      [{ label: "Prompt", channelType: 0 }],
      [],
      [
        { label: "AI搜问", value: AGENT_USAGE_PLATFORM_VALUES.KM_AI_SEARCH },
        { label: "小助理", value: AGENT_USAGE_PLATFORM_VALUES.WORK_AI },
      ],
    );

    expect(options).toEqual([
      { label: "Prompt", value: "1,3,44,36" },
      { label: "AI搜问", value: "km_ai_search" },
      { label: "小助理", value: "work_ai" },
    ]);
  });
});
