// packages/shared-business/src/chat/components/ChatView/constants.ts
//
// ChatView 自身的常量与文件级可变状态。
// 命名约定：仅 ChatView 内部使用，避免与 ChatInput / CompletionView / ChatMessages
// 中各自独立的同名 DEFAULTS 常量在跨文件导入时产生歧义。

// ============================================================================
// Feature flag defaults (ChatView feature props fallbacks)
// ============================================================================

export const CHAT_VIEW_DEFAULTS = {
  history: { enabled: true },
  newConversation: { enabled: true },
  languageSwitcher: { enabled: true },
  guide: { enabled: true },
  message: { showMenu: true },
  welcome: { show: true },
  fileUpload: { allowMultiple: true },
} as const;

// ============================================================================
// OpenClaw snapshot polling (事件流轮询节奏)
// ============================================================================

export const OPENCLAW_EVENT_INITIAL_POLL_INTERVAL = 800;
export const OPENCLAW_EVENT_FAST_POLL_INTERVAL = 2000;
export const OPENCLAW_EVENT_EMPTY_BACKOFF_INTERVALS = [3000, 5000, 10000] as const;

/**
 * 周期性 `/messages?fresh=1` 轮询节拍。仅 openclaw 启用,本地主动 send 时暂停。
 * 设计目标:跨端 / 跨设备补齐其他客户端写入的新 turn,场景化 vs snapshot 事件流轮询。
 */
export const OPENCLAW_MESSAGES_SYNC_POLL_INTERVAL = 5000;

// ============================================================================
// OpenClaw message history fetch
// ============================================================================

export const OPENCLAW_MESSAGE_HISTORY_FETCH_LIMIT = 30;

// ============================================================================
// OpenClaw optimistic conversation virtual id
// (用于在乐观创建会话后,先放入 store 再让后端返回真实 id 的过渡期)
// ============================================================================

export const OPENCLAW_OPTIMISTIC_RESOLVED_VIRTUAL_ID = "__openclaw_optimistic_resolved__";

// ============================================================================
// OpenClaw conversation invalidated event name
// (用于跨组件通知某个 openclaw 会话已失效,需要清理本地状态)
// ============================================================================

export const OPENCLAW_CONVERSATION_INVALIDATED_EVENT = "openclaw:conversation-invalidated";

// ============================================================================
// Module-scoped Set: tracks optimistic-resolved openclaw conversation ids
// (跨组件实例共享;用于在 ChatView 检测 store 中由其他实例乐观写入的会话)
// ============================================================================

export const openClawOptimisticResolvedConversationIds = new Set<string>();