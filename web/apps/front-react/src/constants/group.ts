export const GROUP_TYPE = {
  USER: 1,
  AI_LINK: 2,
  AGENT: 3,
  INTERNAL_USER: 4,
  PROMPT: 5,
  SKILLS: 7,
  KM_FILE_CHAT_QUICK_COMMAND: 101,
  KM_FILE_CHAT_SLIDE_COMMAND: 102,
} as const

export type GroupType = (typeof GROUP_TYPE)[keyof typeof GROUP_TYPE]
