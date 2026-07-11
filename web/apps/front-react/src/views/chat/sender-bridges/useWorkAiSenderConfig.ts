/**
 * useWorkAiSenderConfig — agent_usage === 4 (WORK_AI) 时,
 * 把 IndexChat.tsx 的 sender 行为(技能选择 + 增强 @ 提及)适配到 ChatContainer。
 *
 * 来源:apps/front-react/src/views/index/IndexChat.tsx (lines 357-388, 397-446, 988-1008, 1289-1297, 1795-1825)
 * 限制:
 *   - skill_name 与 display_name 暂时用同一个值(后续 task 3.x 迁移时由消费者提供映射)
 *   - 增强版 @ 下拉的多入口(知识库/上传/AI生成/录音)暂未实装,MVP 用默认 mention
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MentionFeature, SkillFeature, SenderSlots } from "@km/hub-ui-x-react";
import { filesApi } from "@/api/modules/files";
import { formatFile } from "@/api/modules/files/transform";
import { useUserStore } from "@/stores/modules/user";
import { useNavigationStore } from "@/stores/modules/navigation";
import { useSkillsStore } from "@/stores/modules/skills";
import { useChatFeedback } from "@km/shared-business/chat";
import { t } from "@/locales";
import { checkVersion } from "@/utils/version";
import { VERSION_MODULE } from "@/constants/enterprise";
import { checkPermission } from "@/utils/permission";
import { api_host } from "@/utils/config";
import uploadApi from "@/api/modules/upload";
import { AGENT_USAGES } from "@/constants/agent";

export interface WorkAiSenderConfig {
  mention: MentionFeature;
  skill: SkillFeature;
  senderSlots: SenderSlots;
  placeholder: string;
  /** 是否启用 @ 提及 */
  canMention: boolean;
  /** 是否启用 / 技能 */
  canSkill: boolean;
  /** 是否有知识库 */
  hasKnowledgeBase: boolean;
  /** 当前选中的技能(用于回传 useChatSend) */
  selectedSkills: Array<{ display_name: string; skill_name?: string }>;
  /**
   * 从 Extras 技能 chip 触发选择:用 display_name 反查 skill_name。
   * 与 skill.onSelect 不同,这个 API 是给 Extras chip(只拿到 display_name)用的。
   */
  selectSkillByDisplayName: (displayName: string) => void;
  /** 自定义 httpRequest(同步到"我上传的"知识库) */
  httpRequest: (file: File) => Promise<any>;
  /** acceptTypes */
  acceptTypes: string;
  /**
   * 4 个 @ 入口的 select/open 工厂收敛(OpenSpec sender-migration §7)。
   * 推荐使用 sources.* 替代下方标 @deprecated 的 openFromX / confirmFromX。
   */
  sources: Record<
    "library" | "uploads" | "ai-generated" | "recordings",
    {
      /** Dialog 确认回调(由 ChatContainer 在 Dialog.onConfirm 接入)。 */
      select: (...args: any[]) => void;
      /** Dialog 打开器(由 ChatContainer 渲染外部 Dialog 后,ref 传入)。 */
      open: (dialogRef: any) => void;
    }
  >;
  /** 发送后清空受控 list(在 ChatContainer.message.onSent 调用) */
  reset: () => void;
  /**
   * 当前选中的 @ 提及链接列表(含 file / library / space)
   * ChatContainer.sendContext 通过它把 selectedMentionLinks 透传给 useChatSend,
   * 用于构建 messages.specified_files(对齐原版 IndexChat.tsx 的 atList 参数)。
   */
  selectedMentionLinks: Array<any>;
  /**
   * 当前 agent 的内置技能列表(已过滤 status === 'disabled')。
   * 单一数据源:本 hook 负责 loadAgentSkills + filter,ChatContainer 不再读 store 派生。
   */
  agentSkills: Array<any>;
}

const WORK_AI_ACCEPT_TYPES =
  ".pdf,.doc,.docx,.txt,.md,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.zip,.rar,.mp3";
const MENTION_DEBOUNCE_MS = 300;

export function useWorkAiSenderConfig(params: { currentAgent: any; enabled: boolean }): WorkAiSenderConfig | null {
  const { currentAgent, enabled } = params;
  const userStore = useUserStore();
  const navigationStore = useNavigationStore();
  // selector 订阅,避免整个 skills store 变化触发下游 effect 重跑(finding #6 / #9)
  const loadSkillList = useSkillsStore((s) => s.loadSkillList);
  const { loadFeedbackConfig } = useChatFeedback();
  
  // ============ State ============
  const [selectedSkills, setSelectedSkills] = useState<Array<{ display_name: string; skill_name?: string }>>([]);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<any>>([]);
  const [recentList, setRecentList] = useState<Array<any>>([]);
  const [selectedMentionLinks, setSelectedMentionLinks] = useState<Array<any>>([]);
  const [skillSearchKeyword, setSkillSearchKeyword] = useState("");
  const [skillSearchLoading, setSkillSearchLoading] = useState(false);
  const [skillSuggestions, setSkillSuggestions] = useState<Array<any>>([]);
  // Agent 内置技能列表（从 SkillsStore 获取）
  const agentSkillsMap = useSkillsStore((state) => state.agentSkillsMap);
  const loadAgentSkillsFromStore = useSkillsStore((state) => state.loadAgentSkills);

  const searchSeqRef = useRef(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skillSearchSeqRef = useRef(0);
  const skillSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ============ 派生 ============
  const hasKnowledgeBase = navigationStore.hasKnowledge && checkVersion(VERSION_MODULE.KNOWLEDGE_BASE);
  const canMention =
    enabled && userStore.is_login && userStore.info.is_internal && (hasKnowledgeBase || checkVersion(VERSION_MODULE.WORKBENCH) || checkVersion(VERSION_MODULE.RECORDING));
  const canSkill = enabled && userStore.is_login;

  // ============ 加载技能列表(探索 + 我的) ============
  // deps 使用 selector 订阅的稳定函数引用;loadFeedbackConfig 在 ChatConfigProvider
  // adapters prop 不变时是稳定的,变化时触发一次重新加载(finding #6)
  useEffect(() => {
    if (!enabled) return;
    Promise.all([
      loadSkillList({ isRefresh: true }).catch(() => []),
      loadFeedbackConfig("work_ai").catch(() => undefined),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // 获取 Agent 内置技能列表（从 SkillsStore 获取）
  useEffect(() => {
    const agentId = currentAgent?.agent_id;
    if (!enabled || !agentId || (currentAgent as any)?.agent_usage !== AGENT_USAGES.WORK_AI) {
      return;
    }
    loadAgentSkillsFromStore(agentId);
  }, [enabled, currentAgent?.agent_id, (currentAgent as any)?.agent_usage, loadAgentSkillsFromStore]);

  // 当前 agent 的技能列表(单源)—— 取自 store,并过滤掉 status === 'disabled' 的项。
  // ChatContainer 直接消费 result.current.agentSkills,不再读 store 派生。
  const agentSkillsAll = agentSkillsMap.get(String(currentAgent?.agent_id)) || [];
  const agentSkills = useMemo(
    () => agentSkillsAll.filter((s: any) => s.status !== 'disabled'),
    [agentSkillsAll],
  );

  // ============ 加载最近文件 ============
  useEffect(() => {
    if (!enabled) return;
    filesApi
      .recently()
      .then((res: any[]) => {
        // 使用 formatFile 把原始 API 数据转换为带 name/icon 的结构(对齐 legacy Sender)
        if (Array.isArray(res)) {
          setRecentList(res.map((f) => formatFile(f)));
        } else {
          setRecentList([]);
        }
      })
      .catch(() => setRecentList([]));
  }, [enabled]);

  // ============ 搜索 @ 文件(防抖) ============
  useEffect(() => {
    if (!enabled) return;
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    const keyword = searchKeyword.trim();
    if (!keyword) {
      setSuggestions([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const mySeq = ++searchSeqRef.current;
    searchTimerRef.current = setTimeout(() => {
      filesApi
        .search({ query: keyword, top_k: 10 })
        .then((res: any) => {
          if (mySeq !== searchSeqRef.current) return;
          const raw = (res && res.results) || [];
          setSuggestions(
            raw.map((item: any) => ({
              id: String(item.file_id),
              name: item.highlight || item.path || "未命名",
              icon: undefined,
              library_id: String(item.library_id || ""),
              library_name: item.library_name || "",
              score: item.score,
              ui: { active: false },
              source: "knowledge",
              isfolder: false,
              islibrary: false,
              isspace: false,
            })),
          );
        })
        .catch(() => {
          if (mySeq !== searchSeqRef.current) return;
          setSuggestions([]);
        })
        .finally(() => {
          if (mySeq === searchSeqRef.current) setSearchLoading(false);
        });
    }, MENTION_DEBOUNCE_MS);
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
    };
  }, [enabled, searchKeyword]);

  // ============ 搜索技能(防抖) ============
  useEffect(() => {
    if (!enabled) return;
    if (skillSearchTimerRef.current) {
      clearTimeout(skillSearchTimerRef.current);
      skillSearchTimerRef.current = null;
    }
    const keyword = skillSearchKeyword.trim();
    if (!keyword) {
      // 关键词为空时,展示全部已启用技能
      setSkillSuggestions(
        agentSkills
          .filter((s: any) => s.admin_status === "enabled" && s.status !== "disabled")
          .map((s: any) => ({
            id: s.id,
            label: s.display_name,
            display_name: s.display_name,
            icon: s.logo || s.icon,
            skill_name: s.skill_name || s.display_name,
            description: s.description,
            bind_type: s.bind_type,
          })),
      );
      setSkillSearchLoading(false);
      return;
    }
    setSkillSearchLoading(true);
    const mySeq = ++skillSearchSeqRef.current;
    skillSearchTimerRef.current = setTimeout(() => {
      // 客户端过滤
      if (mySeq !== skillSearchSeqRef.current) return;
      const filtered = agentSkills
        .filter(
          (s: any) =>
            s.admin_status === "enabled" &&
            s.status !== "disabled" &&
            (s.display_name?.toLowerCase().includes(keyword.toLowerCase()) ||
              s.skill_name?.toLowerCase().includes(keyword.toLowerCase())),
        )
        .map((s: any) => ({
          id: s.id,
          label: s.display_name,
          display_name: s.display_name,
          icon: s.logo,
          skill_name: s.skill_name || s.display_name,
          description: s.description,
          bind_type: s.bind_type,
        }));
      setSkillSuggestions(filtered);
      setSkillSearchLoading(false);
    }, 200);
    return () => {
      if (skillSearchTimerRef.current) {
        clearTimeout(skillSearchTimerRef.current);
        skillSearchTimerRef.current = null;
      }
    };
  }, [enabled, skillSearchKeyword, agentSkills]);

  // ============ @ 提及回调 ============
  const handleSelectMention = useCallback((item: any) => {
    setSelectedMentionLinks((prev) => {
      if (prev.some((p) => String(p.id) === String(item.id))) return prev;
      return [
        ...prev,
        {
          id: String(item.id),
          name: item.name,
          icon: item.icon,
          library_id: item.library_id,
          upload_file_id: item.upload_file_id,
          file_size: item.file_size,
          file_mime: item.file_mime,
          isfolder: false,
          islibrary: false,
          isspace: false,
          ui: { active: true },
          source: "knowledge",
        },
      ];
    });
  }, []);

  const handleRemoveMention = useCallback((item: any) => {
    setSelectedMentionLinks((prev) => prev.filter((p) => String(p.id) !== String(item.id)));
  }, []);

  // ============ Dialog 回调(用于 EnhancedMentionDropdown 4 个入口) ============
  // 把外部 dialog 返回的 files/libraries/spaces 合并到 selectedMentionLinks
  // (保持 source 隔离:同 source 的会被替换,跨 source 保留)
  const bulkReplaceBySource = useCallback((source: string, newLinks: any[]) => {
    setSelectedMentionLinks((prev) => {
      const others = prev.filter((p: any) => p.source !== source);
      return [...others, ...newLinks];
    });
  }, []);

  // Dialog key → mention source 的映射(library 在 mention 内部用 source="knowledge")
  const DIALOG_TO_MENTION_SOURCE: Record<"library" | "uploads" | "ai-generated" | "recordings", string> = {
    library: "knowledge",
    uploads: "uploads",
    "ai-generated": "ai-generated",
    recordings: "recordings",
  };

  // 工厂:把单个 dialog 入口的 select/open 闭包收敛(OpenSpec sender-migration §7)
  const makeFileSource = (
    dialogKey: "library" | "uploads" | "ai-generated" | "recordings",
    selectedMentionLinksSnapshot: any[],
  ) => {
    const mentionSource = DIALOG_TO_MENTION_SOURCE[dialogKey];
    const isLibrary = dialogKey === "library";

    const mapFileLink = (f: any) => ({
      id: String(f.id),
      name: f.name,
      icon: f.icon,
      library_id: isLibrary ? f.library_id : undefined,
      isfolder: !!f.isfolder,
      upload_file_id: f.upload_file_id ?? (isLibrary ? null : (f.upload_file_id ?? null)),
      file_size: isLibrary ? (f.file_size ?? null) : (f.file_size ?? f.upload_file?.size ?? null),
      file_mime: isLibrary ? (f.file_mime ?? null) : (f.file_mime ?? f.upload_file?.mime_type ?? null),
      source: mentionSource as "knowledge" | "uploads" | "ai-generated" | "recordings",
      islibrary: false,
      isspace: false,
      ui: { active: true },
      path: isLibrary ? undefined : f.path,
      rawData: isLibrary ? undefined : f.rawData,
    });

    return {
      // Dialog 确认回调(由 ChatContainer 在 Dialog.onConfirm 接入)
      select: (...args: any[]) => {
        if (isLibrary) {
          const [files = [], libraries = [], spaces = []] = args;
          const newFiles = files.map(mapFileLink);
          const newLibs = libraries.map((l: any) => ({
            id: String(l.id),
            name: l.name,
            icon: l.icon,
            islibrary: true,
            isspace: false,
            source: mentionSource,
            ui: { active: true },
          }));
          const newSpaces = spaces.map((s: any) => ({
            id: String(s.id),
            name: s.name,
            icon: s.icon,
            islibrary: false,
            isspace: true,
            source: mentionSource,
            ui: { active: true },
          }));
          bulkReplaceBySource(mentionSource, [...newFiles, ...newLibs, ...newSpaces]);
        } else {
          const [files = []] = args;
          bulkReplaceBySource(mentionSource, files.map(mapFileLink));
        }
      },
      // Dialog 打开器(由 ChatContainer 渲染外部 Dialog 后,ref 传入)
      open: (dialogRef: any) => {
        if (!dialogRef?.current) return;
        const links = selectedMentionLinksSnapshot.filter((l: any) => l.source === mentionSource);
        if (isLibrary) {
          const files = links.filter((l: any) => !l.islibrary && !l.isspace).map((l: any) => ({
            id: l.id, name: l.name, icon: l.icon, library_id: l.library_id,
            isfolder: l.isfolder, upload_file_id: l.upload_file_id,
            file_size: l.file_size, file_mime: l.file_mime,
          }));
          const libraries = links.filter((l: any) => l.islibrary).map((l: any) => ({ id: l.id, name: l.name, icon: l.icon }));
          const spaces = links.filter((l: any) => l.isspace).map((l: any) => ({ id: l.id, name: l.name, icon: l.icon }));
          dialogRef.current.open(files, libraries, undefined, spaces);
        } else {
          const files = links.map((l: any) => ({
            id: l.id, name: l.name, icon: l.icon, path: l.path, isfolder: l.isfolder, rawData: l.rawData,
          }));
          dialogRef.current.open(files);
        }
      },
    };
  };

  // ============ / 技能回调 ============
  const handleSelectSkill = useCallback((skill: { label: string; display_name?: string; icon?: string; skill_name?: string }) => {
    const displayName = skill.display_name || skill.label;
    setSelectedSkills([
      {
        display_name: displayName,
        skill_name: skill.skill_name || displayName,
      },
    ]);
  }, []);

  /**
   * 从 Extras 的技能 chip 触发选择。
   * 与 handleSelectSkill 不同的是:这里从 agentSkills 反查真实的 skill_name(避免 extras 只拿到 display_name 而导致后端路由错)。
   */
  const selectSkillByDisplayName = useCallback(
    (displayName: string) => {
      const target = agentSkills.find((s: any) => s.display_name === displayName) as any;
      handleSelectSkill({
        label: displayName,
        display_name: displayName,
        skill_name: target?.skill_name || displayName,
        icon: target?.logo,
      });
    },
    [agentSkills, handleSelectSkill],
  );

  const handleRemoveSkill = useCallback(() => {
    setSelectedSkills([]);
  }, []);

  // ============ httpRequest(同步到"我上传的"知识库) ============
  const httpRequest = useCallback((dataFile: File) => {
    return new Promise((resolve, reject) => {
      let isHandled = false;
      const hasPermission = checkPermission({
        onClick: async () => {
          try {
            const res = await uploadApi.upload(dataFile, "my_uploads");
            resolve({
              id: res.data?.id,
              name: dataFile.name,
              size: dataFile.size,
              mime_type: dataFile.type,
              preview_key: res.data?.preview_key,
              url: res.data?.preview_key ? `${api_host}/api/preview/${res.data.preview_key}` : "",
            });
          } catch (error) {
            reject(error);
          }
        },
        onFailed: () => {
          isHandled = true;
          reject(new Error("Permission denied"));
        },
      });
      if (!hasPermission && !isHandled) {
        reject(new Error("Permission denied"));
      }
    });
  }, []);

  // ============ mention / skill 配置 ============
  const mention: MentionFeature = useMemo(
    () => ({
      enabled: Boolean(canMention),
      tooltip: t("work_ai.knowledge_placeholder"),
      // 增强版标记(work-ai 模式)
      enhanced: true,
      hasKnowledgeBase: Boolean(hasKnowledgeBase),
      allowSelectLibrary: true,
      allowSelectSpace: true,
      list: selectedMentionLinks,
      suggestions,
      recentList,
      searchKeyword,
      searchLoading,
      onSearch: setSearchKeyword,
      onSelect: handleSelectMention,
      onRemove: handleRemoveMention,
    }),
    [
      canMention,
      hasKnowledgeBase,
      selectedMentionLinks,
      suggestions,
      recentList,
      searchKeyword,
      searchLoading,
      handleSelectMention,
      handleRemoveMention,
    ],
  );

  const skill: SkillFeature = useMemo(
    () => ({
      enabled: Boolean(canSkill),
      list: selectedSkills.map((s) => ({ label: s.display_name, display_name: s.display_name, skill_name: s.skill_name })),
      suggestions: skillSuggestions,
      searchKeyword: skillSearchKeyword,
      searchLoading: skillSearchLoading,
      onSearch: setSkillSearchKeyword,
      onSelect: handleSelectSkill,
      onRemove: handleRemoveSkill,
    }),
    [canSkill, selectedSkills, skillSuggestions, skillSearchKeyword, skillSearchLoading, handleSelectSkill, handleRemoveSkill],
  );

  const senderSlots: SenderSlots = useMemo(() => ({}), []);
  const placeholder = t("work_ai.chat_placeholder");

  // 清空受控 list(在 ChatContainer.message.onSent 调用)
  // 注意:必须放在 `if (!enabled) return null` 之前,否则 enabled 翻转时
  // 这 5 个 hook 的位置会变化,导致 React 内部 hook list 错位(规则:Hooks
  // 必须在每次渲染以相同顺序调用)。
  const reset = useCallback(() => {
    setSelectedMentionLinks([]);
    setSelectedSkills([]);
  }, []);

  // ============ Dialog 打开器 / 确认回调 (factory 收敛) ============
  // 通过 sources.* 暴露 4 个 dialog 入口(OpenSpec sender-migration §7)
  const sources = useMemo(
    () => ({
      library: makeFileSource("library", selectedMentionLinks),
      uploads: makeFileSource("uploads", selectedMentionLinks),
      "ai-generated": makeFileSource("ai-generated", selectedMentionLinks),
      recordings: makeFileSource("recordings", selectedMentionLinks),
    }),
    [selectedMentionLinks, bulkReplaceBySource],
  );

  if (!enabled) return null;

  return {
    mention,
    skill,
    senderSlots,
    placeholder,
    canMention,
    canSkill,
    hasKnowledgeBase,
    selectedSkills,
    /** 从 extras chip 触发技能选择(用 display_name 反查 skill_name) */
    selectSkillByDisplayName,
    httpRequest,
    acceptTypes: WORK_AI_ACCEPT_TYPES,
    sources,
    reset,
    selectedMentionLinks,
    /** 当前 agent 的内置技能列表(已过滤 disabled),供 WorkAiSenderExtras 消费 */
    agentSkills,
  };
}
