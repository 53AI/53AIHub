// Model constants - placeholder for future expansion

export const MODEL_TYPES = {
  CHAT: 'chat',
  EMBEDDING: 'embedding',
  RERANK: 'rerank',
} as const

export type ModelType = (typeof MODEL_TYPES)[keyof typeof MODEL_TYPES]
