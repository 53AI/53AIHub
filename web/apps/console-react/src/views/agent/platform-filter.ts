import {
  getOpenClawCompatibleChannelType,
  isOpenClawCompatibleAgentType,
  isOpenClawCompatibleChannelType,
} from "@km/shared-business/agent-create";
import type { AgentPlatformOption } from "@km/shared-business/agent-create";
import { AGENT_USAGES } from "@/constants/agent";

export interface AgentListFilterFormLike {
  group_id: number;  // 单选
  platform: string;
  type: string;
  keyword: string;
  page: number;
  page_size: number;
}

export interface AgentListParams {
  group_id: string;
  channel_types?: string;
  agent_usages?: string;
  agent_types: string;
  keyword: string;
  offset: number;
  limit: number;
}

export interface PlatformFilterChannelOption {
  label: string;
  channelType: number;
}

export interface PlatformFilterOption {
  label: string;
  value: string;
}

// agent_usage 维度的筛选值(下拉里用的语义 token,非数字)
// 后端 /api/agents/group 接收 agent_usages 字符串,按 AGENT_USAGES 映射
export const AGENT_USAGE_PLATFORM_VALUES = {
  KM_AI_SEARCH: "km_ai_search", // AI搜问
  WORK_AI: "work_ai",          // 小助理
} as const;

const AGENT_USAGE_VALUE_TO_USAGE: Record<string, number> = {
  [AGENT_USAGE_PLATFORM_VALUES.KM_AI_SEARCH]: AGENT_USAGES.KM_AI_SEARCH,
  [AGENT_USAGE_PLATFORM_VALUES.WORK_AI]: AGENT_USAGES.WORK_AI,
};

export type ResolveAgentPlatformResult =
  | Pick<AgentListParams, "channel_types">
  | Pick<AgentListParams, "agent_usages">;

export function resolveAgentPlatformFilter(platform?: string): ResolveAgentPlatformResult {
  const platformValue = String(platform || "").trim();
  if (!platformValue) return {};
  // AI搜问 / 小助理 通过 agent_usage 维度筛选,不走 channel_types
  if (platformValue in AGENT_USAGE_VALUE_TO_USAGE) {
    return { agent_usages: String(AGENT_USAGE_VALUE_TO_USAGE[platformValue]) };
  }
  if (isOpenClawCompatibleAgentType(platformValue)) {
    return { channel_types: String(getOpenClawCompatibleChannelType(platformValue)) };
  }
  return { channel_types: platformValue };
}

export function buildAgentListParams(currentFilter: AgentListFilterFormLike): AgentListParams {
  return {
    group_id: currentFilter.group_id ? String(currentFilter.group_id) : "",
    ...resolveAgentPlatformFilter(currentFilter.platform),
    agent_types: currentFilter.type,
    keyword: currentFilter.keyword,
    offset: (currentFilter.page - 1) * currentFilter.page_size,
    limit: currentFilter.page_size,
  };
}

export function createAgentPlatformFilterOptions(
  channelOptions: PlatformFilterChannelOption[],
  platforms: AgentPlatformOption[],
  extraOptions: PlatformFilterOption[] = [],
): PlatformFilterOption[] {
  const legacyChannelOptions = channelOptions
    .filter((item) => !isOpenClawCompatibleChannelType(item.channelType))
    .map((item) => ({
      label: item.label,
      value: item.channelType === 0 ? "1,3,44,36" : String(item.channelType),
    }));

  const openClawCompatibleOptions = platforms
    .filter((platform) => isOpenClawCompatibleChannelType(platform.channel_type))
    .map((platform) => ({
      label: platform.label,
      value: String(platform.channel_type),
    }));

  return [
    ...legacyChannelOptions,
    ...openClawCompatibleOptions,
    ...extraOptions,
  ];
}
