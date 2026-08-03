// Adapters
export {
  AdapterProvider,
  AdapterContext,
  useAgentCreateAdapter,
  useSupportedPlatforms,
} from './adapters'

export type {
  AgentType,
  ConfigKey,
  GroupOption,
  ModelOption,
  ChannelOption,
  AgentFormData,
  Settings,
  CustomConfig,
  CompletionParams,
  FileParseConfig,
  ImageParseConfig,
  SuggestedQuestion,
  FieldItem,
  RelateAgent,
  PageLayoutProps,
  ModelSelectProps,
  GroupSelectProps,
  IAgentCreateAdapter,
  AdapterContextValue,
  AdapterProviderProps,
  // CreateAgentDialog types
  AgentTypeOption,
  AgentPlatformOption,
  CreateAgentDialogProps,
  CreateAgentDialogResult,
  AvatarSlotProps,
  // Scope types
  ScopeItem,
} from './adapters'

// Types (includes default value factories)
export type {
  AgentFormState,
  AgentFormActions,
  AgentFormStore,
  AgentFormRef,
  UseAgentFormReturn,
  ChannelConfigData,
  ChannelFormState,
} from './types'

export {
  getDefaultSettings,
  getDefaultCustomConfig,
  getInitialFormData,
  getDefaultFieldItem,
  getInitialState,
} from './types'

// Store
export { useAgentFormStore } from './store'

// Hooks
export { useAgentForm, usePlatformChannel, useAgentPreviewSender } from './hooks'
export { buildKnowledgeSourcePayload } from './hooks'
export type {
  UsePlatformChannelOptions,
  UsePlatformChannelReturn,
  AgentPreviewSenderConfig,
  AgentPreviewModelOption,
  PreviewKnowledgeSourceState,
  KnowledgeSourceConfig,
} from './hooks'

// Components
export {
  AgentDrawer,
  AgentGuide,
  CreatePageLayout,
  ChannelConfigContext,
  useChannelConfig,
  AgentBasicInfo,
  AgentInfo,
  AgentTypeSelector,
  UseScope,
  BaseConfig,
  ExpandConfig,
  FieldInput,
  FieldInputSetting,
  LimitConfig,
  RelateAgents,
  RelateAgentsDialog,
  RelateAgentsSetting,
  UsageChannel,
  Chat,
  Completion,
  PreviewModelSelector,
  PreviewKnowledgeSourceSelector,
} from './components'

export type {
  AgentDrawerRef,
  ChannelConfig,
  CreatePageLayoutProps,
  AgentBasicInfoProps,
  AgentBasicInfoValue,
  UsageChannelProps,
  ChatRef,
  CompletionRef,
  PreviewModelSelectorProps,
  PreviewKnowledgeSourceSelectorProps,
} from './components'

// Constants
export {
  AGENT_TYPES,
  BACKEND_AGENT_TYPE,
  AGENT_MODES,
  OPENCLAW_COMPATIBLE_AGENT_METADATA,
  OPENCLAW_COMPATIBLE_AGENT_TYPES,
  OPENCLAW_COMPATIBLE_CHANNEL_TYPES,
  OPENCLAW_WS_CHANNEL_TYPE,
  OPENCLAW_WS_MODEL,
  QCLAW_WS_CHANNEL_TYPE,
  CODEX_WS_CHANNEL_TYPE,
  MANUS_WS_CHANNEL_TYPE,
  getOpenClawCompatibleAgentIconPath,
  getOpenClawCompatibleAgentMetadata,
  getOpenClawCompatibleChannelType,
  isOpenClawCompatibleChannelType,
  isOpenClawCompatibleAgentType,
  normalizeOpenClawCompatibleCustomConfig,
  resolveOpenClawCompatibleAgentLogo,
  resolveOpenClawCompatibleAgentTypeFromRecord,
  resolveOpenClawCompatibleAgentTypeFromChannelType,
} from './constants'
export type { AgentPlatformType, OpenClawCompatibleAgentMetadata, OpenClawCompatibleAgentRecord, OpenClawCompatibleAgentType } from './constants'

// AgentForm (platform router)
export { AgentForm } from './platform'
export type { AgentFormRef as PlatformAgentFormRef } from './platform'

// Openclaw component (now part of AgentForm system)
export { Openclaw, buildOpenClawInstallCommand } from './platform/Openclaw'
export type { OpenclawRef } from './platform/Openclaw'

// Language pack
export { agentCreateMessages } from './locales'

// CreateAgentDialog (add agent)
export { CreateAgentDialog } from './components/add'

// Platform config
export {
  AGENT_TYPE_OPTIONS,
  createPlatformsByType,
  createFrontPlatformsByType,
  createConsoleTypeOptions,
  createFrontTypeOptions,
} from './platformConfig'
