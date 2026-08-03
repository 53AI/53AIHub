// packages/shared-business/src/chat/components/index.ts

// Core components
export { default as Welcome, type WelcomeProps } from "./Welcome";
export { default as ChatHistory, type ChatHistoryRef, type ChatHistoryProps } from "./ChatHistory";
export { default as UsageGuide, type UsageGuideProps } from "./UsageGuide";
export { default as LoadingState, type LoadingStateProps } from "./LoadingState";
export { default as MessageMenu, type MessageMenuProps, type MessageMenuFeatures } from "./MessageMenu";

// Chat components (new structure)
export * from "./ChatView";
export { ChatMessages, DEFAULT_FEATURES, OpenClawActivityList } from "./ChatMessages";
export type {
  ChatMessagesProps,
  ChatMessagesSlots,
  MessageMenuSlotProps,
  MessageSelectionFeature,
  WelcomeFeature as ChatMessagesWelcomeFeature,
  OpenClawFeature,
  LoadMoreFeature,
  MessageActionFeature,
  FileActionFeature,
  SourceActionFeature,
} from "./ChatMessages";

// Feature components
export * from "./completion";
export * from "./share";
export * from "./related-scene";
export * from "./process-flow";
export {
  UserMessage as UserMessageComponent,
  type UserMessageProps,
  AssistantMessage,
  type AssistantMessageProps,
  MessageItem,
  type MessageItemProps,
  OpenClawTimeline,
  type OpenClawTimelineProps,
} from "./message";
export * from "./feedback";
export * from "./source";
export * from "./output";
export * from "./openclaw-preview";
