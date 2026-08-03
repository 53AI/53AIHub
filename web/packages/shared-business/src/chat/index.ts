// packages/shared-business/src/chat/index.ts

// Hooks (formerly engine)
export * from "./hooks";

// Stores
export * from "./stores";

// Adapters
export * from "./adapters";

// Types (注意：types/index.ts 已 re-export types/message.ts)
export * from "./types";

// Utils
export {
  buildKnowledgeSourcePayload,
  type KnowledgeSourcePayloadConfig,
  type KnowledgeSourcePayload,
  type WikiItemPayload,
} from "./utils/buildKnowledgeSourcePayload";
export * from "./utils/openclaw";
export * from "./utils/openclaw-activities";
export * from "./utils/openclaw-adapter";
export * from "./utils/openclaw-chatview-helpers";
export * from "./utils/openclaw-ledger";
export * from "./utils/openclaw-timeline";
export * from "./utils/openclaw-turn";
export * from "./utils/openclaw-transport";
export * from "./utils/output-file-download";

// Components
export * from "./components";

// i18n (合并了 URL 配置)
export { chatMessages } from "./locales";
export { ChatConfigProvider, useTranslation, useChatConfig, useKnowledgePanel, buildLibraryUrl, useChatAdapters } from "./i18n";
export type { Lang, ChatUrlConfig, ChatConfigProviderProps, KnowledgePanelData, OnOpenKnowledgePanel, IChatAdapters, IChunkPopupApi, IFileLinkApi, IFileDownloadApi, IFeedbackApi, IFeedbackContext, IShareApi, IShareContext, IPlatformContext, IPermissionContext, IMessagesApi } from "./i18n";
