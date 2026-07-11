export const AGENT_USAGES = {
  HUB: 0,
  KM_AI_SEARCH: 1,
  KM_FILE_CHAT: 2,
  KM_FILE_MAP: 3,
  WORK_AI: 4,
}

export const REASONING_MODE = {
  DEEP: 'deep',
  FAST: 'fast'
} as const

export type ReasoningMode = (typeof REASONING_MODE)[keyof typeof REASONING_MODE]
