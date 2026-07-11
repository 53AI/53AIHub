import { createContext, useContext, ReactNode, useState, useCallback, useEffect, useMemo } from "react";
import { chatMessages } from "./locales";
import type { IAgentRunApi, IConversationApi, IAgentApi, IWorkflowApi, ISkillApi, IRecentUsedApi } from "./adapters/types";

export type Lang = "zh-cn" | "zh-tw" | "en" | "ja";

/** 前缀，避免覆盖主站翻译 */
const PREFIX = "_shared.";

/** 知识面板打开数据 */
export interface KnowledgePanelData {
  type: 'knowledge_search' | 'source_click' | 'scope_narrowing';
  files?: any[];
  source?: any;
}

/** 知识面板打开回调 */
export type OnOpenKnowledgePanel = (data: KnowledgePanelData) => boolean | void;

/** URL 配置 */
export interface ChatUrlConfig {
  /** 前台基础 URL，用于构建跨应用跳转链接 */
  frontUrl?: string;
  /** 自定义构建文档 URL 函数（优先级高于 frontUrl） */
  buildLibraryUrl?: (libraryId: string | number, fileId: string | number) => string;
}

/** Feedback API 接口 */
export interface IFeedbackApi {
  getConfig(params: { eid: string; type?: string }): Promise<{ value: string }>;
  getFeedback(params: { message_id: string | number }): Promise<any>;
  createFeedback(body: {
    description: string;
    feedback_type: string;
    message_id: string | number;
    question: string;
    reason: string;
  }): Promise<{ id: number }>;
  updateFeedback(id: number, body: {
    description: string;
    feedback_type: string;
    message_id: string | number;
    question: string;
    reason: string;
  }): Promise<{ id: number }>;
  deleteFeedback(id: number): Promise<void>;
}

/** Feedback 上下文接口 */
export interface IFeedbackContext {
  getEid(): string;
}

/** Share API 接口 */
export interface IShareApi {
  create(data: {
    message_ids: string | number | Array<string | number>;
    conversation_id: string | number;
    select_all: boolean;
  }): Promise<{ share_id: string }>;
}

/** Share 上下文接口 */
export interface IShareContext {
  buildUrl(path: string, params?: Record<string, any>): string;
  t(key: string, ...args: any[]): string;
  showSuccess(message: string): void;
  copyToClipboard(text: string): Promise<void | boolean>;
  encodeShortId?(text: string): Promise<string>;
}

/** Workflow 上下文接口 */
// 注意：`IWorkflowContext` 已在 unify-chat-adapters 重构中删除。
// 原 `createConversation / t / showWarning` 迁入 `IPlatformContext`，
// 原 `checkPermission` 迁入 `IPermissionContext`，
// 原 `run` 迁入 `@km/shared-business/chat` 的 `IWorkflowApi`（由 `ChatPluginProvider` 注入）。

/** Messages API 接口 */
export interface IMessagesApi {
  loadMessages(conversationId: string, params: { offset: number; limit: number }): Promise<any>;
}

/** Chunk 弹窗 API 接口 */
export interface IChunkPopupApi {
  /** 获取 chunk 详情 */
  fetchChunkDetail(chunkId: string | number): Promise<{ content: string; token_count?: number; chunk_index?: number }>;
  /** Markdown 渲染 */
  renderMarkdown(element: HTMLDivElement, content: string): Promise<void>;
  /** 打开 chunk 所属知识库 */
  onOpenLibrary?: (chunk: any) => void;
}

/** 文件链接适配器接口 */
export interface IFileLinkApi {
  /** 获取文件跳转链接 */
  getFileLink(file: {
    id: string | number;
    library_id?: string | number;
    isfolder?: boolean;
    islibrary?: boolean;
    isspace?: boolean;
  }): string;
}

/** 文件下载适配器接口 */
export interface IFileDownloadApi {
  /** 下载沙箱文件，返回 Blob 数据 */
  downloadFile(id: string | number): Promise<Blob>;
}

/** 平台工具方法（跨包通用，无具体业务语义） */
export interface IPlatformContext {
  /** 创建一个新会话（来自 useConversationStore） */
  createConversation(agentId: string, title?: string, fileId?: string): Promise<{ conversation_id: string | number }>;
  /** i18n 翻译 */
  t(key: string, ...args: any[]): string;
  /** 顶部轻量提示（warn 级别） */
  showWarning(message: string): void;
}

/** 权限工具方法 */
export interface IPermissionContext {
  checkPermission(options: {
    groupIds?: number[];
    onClick: () => void | Promise<void>;
  }): boolean;
}

/** 聊天模块所需的全部依赖适配器 */
export interface IChatAdapters {
  feedback?: {
    api: IFeedbackApi;
    context: IFeedbackContext;
  };
  share?: {
    api: IShareApi;
    context: IShareContext;
  };
  messages?: {
    api: IMessagesApi;
  };
  /** 会话 API（unify-chat-adapters：从原 PluginAdapters.conversationApi 迁入） */
  conversationApi?: IConversationApi;
  /** Agent API（unify-chat-adapters：从原 PluginAdapters.agentApi 迁入） */
  agentApi?: IAgentApi;
  /** Workflow API（unify-chat-adapters：从原 PluginAdapters.workflowApi 迁入） */
  workflowApi?: IWorkflowApi;
  /** Chunk 弹窗适配器 */
  chunkPopup?: IChunkPopupApi;
  /** 文件链接适配器（用于 SpecifiedFiles 跳转） */
  fileLink?: IFileLinkApi;
  /** 文件下载适配器（用于沙箱文件下载） */
  fileDownload?: IFileDownloadApi;
  /** Agent Run API（离线运行恢复） */
  agentRun?: IAgentRunApi;
  /** Recent Used API（保存最近使用记录：@ 文件/知识库/空间） */
  recentUsed?: IRecentUsedApi;
  /** Skill API（OpenClaw / Sender 技能列表） */
  skillApi?: ISkillApi;
  /** 平台工具（createConversation / t / showWarning） */
  platform?: IPlatformContext;
  /** 权限工具（checkPermission） */
  permission?: IPermissionContext;
}

interface ChatContextValue extends ChatUrlConfig {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** 知识面板打开回调 */
  onOpenKnowledgePanel?: OnOpenKnowledgePanel;
  /** 适配器配置 */
  adapters?: IChatAdapters;
}

const ChatContext = createContext<ChatContextValue>({
  lang: "zh-cn",
  setLang: () => {},
  t: (key: string) => key,
});

const LANG_KEY = "agentplugin-lang";

function detectBrowserLanguage(): Lang {
  const browserLang = navigator.language.toLowerCase();
  if (browserLang.startsWith("zh-tw") || browserLang.startsWith("zh-hant")) {
    return "zh-tw";
  }
  if (browserLang.startsWith("zh")) {
    return "zh-cn";
  }
  if (browserLang.startsWith("ja")) {
    return "ja";
  }
  if (browserLang.startsWith("en")) {
    return "en";
  }
  return "zh-cn";
}

export interface ChatConfigProviderProps {
  lang?: Lang;
  frontUrl?: string;
  buildLibraryUrl?: (libraryId: string | number, fileId: string | number) => string;
  /**
   * 知识面板打开回调
   *
   * **前台场景**: 传入打开侧边栏逻辑，展示知识检索详情
   * - type='knowledge_search': 打开 ThinkKnowledge 侧边栏
   * - type='source_click': 打开侧边栏并选中对应文件
   * - type='scope_narrowing': 打开侧边栏并选中对应知识库
   *
   * **后台场景**: 传入跳转前台逻辑
   * - type='knowledge_search'/'source_click': 跳转前台文档详情页
   * - type='scope_narrowing': 跳转前台知识库首页
   *
   * 返回 true 表示已处理，返回 false 则使用默认行为（相对路径跳转，仅前台适用）
   */
  onOpenKnowledgePanel?: OnOpenKnowledgePanel;
  /** 适配器配置，用于注入平台特定依赖 */
  adapters?: IChatAdapters;
  children: ReactNode;
}

export function ChatConfigProvider({
  lang: langProp,
  frontUrl,
  buildLibraryUrl,
  onOpenKnowledgePanel,
  adapters,
  children,
}: ChatConfigProviderProps) {
  const [lang, setLangState] = useState<Lang>(() => {
    // Priority: prop > localStorage > browser language > default
    if (langProp) {
      return langProp as Lang;
    }
    const stored = localStorage.getItem(LANG_KEY) as Lang | null;
    if (stored) {
      return stored;
    }
    return detectBrowserLanguage();
  });

  // 同步外部 prop 变化
  useEffect(() => {
    if (langProp && langProp !== lang) {
      setLangState(langProp as Lang);
    }
  }, [langProp, lang]);

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    localStorage.setItem(LANG_KEY, newLang);
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    const messages = chatMessages[lang] || chatMessages["zh-cn"];
    // 自动添加前缀
    const fullKey = PREFIX + key;
    const parts = fullKey.split(".");
    let result: any = messages;
    for (const part of parts) {
      if (result && typeof result === "object" && part in result) {
        result = result[part];
      } else {
        return key;
      }
    }
    let text = typeof result === "string" ? result : key;

    // 处理插值 {{param}}
    if (params && typeof text === "string") {
      text = text.replace(/\{\{(\w+)\}\}/g, (_, paramKey) => {
        return params[paramKey] !== undefined ? String(params[paramKey]) : `{{${paramKey}}}`;
      });
    }

    return text;
  }, [lang]);

  // unify-chat-adapters #6：memoize context value，避免外层 adapters wrapper
  // 身份翻转时透传所有 useChatAdapters() consumer 的 effect re-fire。
  // 必须在 `t` 的 useCallback 定义之后调用（TDZ）。
  const value = useMemo(
    () => ({ lang, setLang, t, frontUrl, buildLibraryUrl, onOpenKnowledgePanel, adapters }),
    [lang, setLang, t, frontUrl, buildLibraryUrl, onOpenKnowledgePanel, adapters]
  );

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}

export function useTranslation() {
  return useContext(ChatContext);
}

/** 获取 URL 配置 */
export function useChatConfig(): ChatUrlConfig {
  const { frontUrl, buildLibraryUrl } = useContext(ChatContext);
  return { frontUrl, buildLibraryUrl };
}

/** 获取知识面板回调 */
export function useKnowledgePanel(): OnOpenKnowledgePanel | undefined {
  return useContext(ChatContext).onOpenKnowledgePanel;
}

/** 构建 library URL 的工具函数 */
export function buildLibraryUrl(
  config: ChatUrlConfig,
  libraryId: string | number | undefined | null,
  fileId: string | number | undefined | null
): string | null {
  if (!libraryId || !fileId) return null;

  // 优先使用自定义函数
  if (config.buildLibraryUrl) {
    return config.buildLibraryUrl(libraryId, fileId);
  }

  // 使用 frontUrl 前缀
  if (config.frontUrl) {
    return `${config.frontUrl}/library/${libraryId}/file/${fileId}`;
  }

  // 默认相对路径（前台应用）
  return `/library/${libraryId}/file/${fileId}`;
}

/** 获取适配器配置（可选：缺 provider 时返回 undefined） */
export function useChatAdapters(): IChatAdapters | undefined {
  return useContext(ChatContext).adapters;
}

/**
 * 获取适配器配置（强约束：缺 provider 时 throw actionable 错误）。
 * 供 useChatSend / useWorkflowSend 等关键 hook 在缺少 ChatConfigProvider
 * 时给出可读错误，而不是 NPE。
 */
export function useRequiredChatAdapters(): IChatAdapters {
  const adapters = useContext(ChatContext).adapters;
  if (!adapters) {
    throw new Error(
      'useRequiredChatAdapters must be used within a ChatConfigProvider. ' +
      'Wrap your component in <ChatConfigProvider adapters={...}>.'
    );
  }
  return adapters;
}
