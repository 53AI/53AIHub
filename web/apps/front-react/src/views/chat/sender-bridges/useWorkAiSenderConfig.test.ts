/**
 * useWorkAiSenderConfig — agentSkills 字段暴露(单源)
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const loadAgentSkillsFn = vi.fn().mockResolvedValue([]);
  const loadSkillListFn = vi.fn().mockResolvedValue([]);
  const loadMySkillListFn = vi.fn().mockResolvedValue([]);
  const loadFeedbackConfigFn = vi.fn().mockResolvedValue({ enable: false });
  const userStore = { info: { eid: "user-1", is_internal: 1, access_token: "token-1" }, is_login: true };
  const navigationStore = { hasKnowledge: false };
  const skillList: any[] = [];
  const mySkillList: any[] = [];
  let agentSkillsMap = new Map<string, any[]>();
  const skillsState = {
    loadAgentSkills: loadAgentSkillsFn,
    loadSkillList: loadSkillListFn,
    loadMySkillList: loadMySkillListFn,
    skillList,
    mySkillList,
    agentSkillsMap, // 注:被 hook 引用,但 hook 是 useSkillsStore(s => s.agentSkillsMap),所以 map 必须稳定
  };
  const feedbackState = {
    loadFeedbackConfig: loadFeedbackConfigFn,
    feedbackConfig: { enable: false },
  };
  return {
    loadAgentSkills: loadAgentSkillsFn,
    loadSkillList: loadSkillListFn,
    loadMySkillList: loadMySkillListFn,
    loadFeedbackConfig: loadFeedbackConfigFn,
    userStore,
    navigationStore,
    skillList,
    mySkillList,
    skillsState,
    feedbackState,
    get agentSkillsMap() { return agentSkillsMap; },
    set agentSkillsMap(v: Map<string, any[]>) { agentSkillsMap = v; skillsState.agentSkillsMap = v; },
  };
});

vi.mock("@/stores/modules/user", () => ({
  useUserStore: () => mocks.userStore,
}));

vi.mock("@/stores/modules/navigation", () => ({
  useNavigationStore: () => mocks.navigationStore,
}));

vi.mock("@/stores/modules/skills", () => ({
  useSkillsStore: (selector?: any) => (selector ? selector(mocks.skillsState) : mocks.skillsState),
}));

vi.mock("@km/shared-business/chat", () => ({
  useChatFeedback: () => mocks.feedbackState,
}));

vi.mock("@/api/modules/files", () => ({
  filesApi: {
    recently: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue({ results: [] }),
  },
}));

vi.mock("@/api/modules/files/transform", () => ({
  formatFile: (f: any) => f,
}));

vi.mock("@/api/modules/upload", () => ({
  default: { upload: vi.fn() },
}));

vi.mock("@/locales", () => ({ t: (k: string) => k }));

vi.mock("@km/shared-utils", () => ({
  cacheManager: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), delete: vi.fn() },
  CacheMode: { LOCAL_STORAGE: "local" },
  eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  formatFileInfo: () => ({ ext: "", mime: "", fname: "", icon: "" }),
}));

vi.mock("@/utils/permission", () => ({ checkPermission: vi.fn().mockReturnValue(true) }));
vi.mock("@/utils/version", () => ({ checkVersion: vi.fn().mockReturnValue(false) }));
vi.mock("@/utils/config", () => ({ api_host: "http://test-host" }));

import { AGENT_USAGES } from "@/constants/agent";
import { useWorkAiSenderConfig } from "./useWorkAiSenderConfig";

afterEach(() => {
  vi.clearAllMocks();
  mocks.agentSkillsMap = new Map();
});

describe("useWorkAiSenderConfig — agentSkills 字段", () => {
  it("WORK_AI 模式下,hook 调用 store.loadAgentSkills 并暴露 agentSkills(过滤掉 disabled)", async () => {
    const workAiAgent = {
      agent_id: 42,
      agent_usage: AGENT_USAGES.WORK_AI,
      settings: {},
    };
    mocks.agentSkillsMap.set("42", [
      { id: "s1", display_name: "技能一", skill_name: "skill-1", status: "enabled", logo: "l1" },
      { id: "s2", display_name: "技能二(禁用)", skill_name: "skill-2", status: "disabled", logo: "l2" },
      { id: "s3", display_name: "技能三", skill_name: "skill-3", status: "enabled", logo: "l3" },
    ]);

    const { result } = renderHook(() =>
      useWorkAiSenderConfig({ currentAgent: workAiAgent, enabled: true })
    );

    await waitFor(() => expect(result.current).not.toBeNull());

    expect(mocks.loadAgentSkills).toHaveBeenCalledWith(42);

    const agentSkills = (result.current as any).agentSkills;
    expect(agentSkills).toBeDefined();
    expect(agentSkills).toHaveLength(2);
    expect(agentSkills.map((s: any) => s.id)).toEqual(["s1", "s3"]);
  });
});
