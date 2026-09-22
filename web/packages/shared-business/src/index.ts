// Agent Create Module
export * from './agent-create'

// Chat Module (exclude useTranslation to avoid conflict with auth)
export * from './chat'

// Auth Module - exclude useTranslation to avoid conflict with chat module
export { LoginForm, useSSO, useAuthGuard, authMessages, AuthI18nProvider } from './auth'
export { useTranslation as useAuthTranslation } from './auth'

// Knowledge Pipeline Module (includes dataPipelineMessages)
export * from './knowledge-pipeline'

// Recording Template Module
export * from './recording-template'

// agent-create 与 chat 都导出了 buildKnowledgeSourcePayload（前者是 agent 场景的包装版），
// 显式指定根包导出 chat 的共享实现，避免 export * 二义性（TS2308）
export { buildKnowledgeSourcePayload } from './chat'
