// 不迁移的组件
export { Sender } from './Sender'
export type { SenderRef } from './Sender'

// 作为 slot 传递
export { AddAnswerAsMd } from './AddAnswerAsMd'
export type { AddAnswerAsMdRef } from './AddAnswerAsMd'

// 本地包装组件（使用 shared-business 组件 + adapters）
export { Graph } from './Graph'
export type { GraphRef } from './Graph'

// 需要适配的组件（保留本地版本，API 不兼容）
export { ShareHeader } from './ShareHeader'

// 保留的组件（目标版本功能不完整）
export { ThinkKnowledge } from './ThinkKnowledge'
export type { ThinkKnowledgeRef } from './ThinkKnowledge'

// 已迁移到 shared-business 的组件（使用重导出）
export {
  FeedbackPanel,
  RagHeader,
  Quotation,
  SpecifiedFiles,
  Chunk,
  type ChunkRef,
  type ChunkProps,
  OutputFiles,
  MessageMenu,
  type MessageMenuProps,
  type MessageMenuFeatures,
} from '@km/shared-business/chat'
