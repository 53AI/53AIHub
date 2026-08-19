/** 记忆条目 */
export interface MemoryItem {
  /** 记忆内容（前端唯一需要关心的字段） */
  fact: string
  /** 来源：user_input | inference | system | user_edit */
  source?: string
  /** 毫秒时间戳 */
  time?: number
  /** 分类：preference（偏好/习惯） | fact（核心事实/项目知识） */
  category?: string
  /** 逗号分隔的关键词标签，用于智能筛选（如 "技术栈,Go"） */
  tags?: string
  /** 过期时间 */
  expire_at?: number
}

/** 工具教训条目 */
export interface ToolLessonItem {
  /** 工具名称 */
  tool_name?: string
  /** 教训内容 */
  lesson: string
  /** 分类 */
  category?: string
  /** true=成功经验，false=失败教训 */
  success?: boolean
  /** 毫秒时间戳 */
  time?: number
}

/** Agent 用户记忆响应 */
export interface AgentUserMemoryResponse {
  id: number
  eid: number
  agent_id: number
  user_id: number
  /** JSON: MemoryItem[] */
  items: string
  /** Markdown，由 items 自动生成 */
  memory_content: string
  version: number
}

/** Agent 工具教训响应 */
export interface AgentToolLessonsResponse {
  id: number
  eid: number
  agent_id: number
  user_id: number
  /** JSON: ToolLessonItem[] */
  lessons: string
  version: number
}

/** 用户全局记忆响应 */
export interface UserMemoryResponse {
  id: number
  eid: number
  user_id: number
  /** 昵称（只读） */
  nickname: string
  /** 部门（只读） */
  department: string
  /** 职位 */
  position?: string
  /** 期望风格 */
  style?: string
  /** 智能记忆 JSON: MemoryItem[] 或纯文本 */
  smart_memory: string
  /** 自定义记忆 JSON: MemoryItem[] 或纯文本 */
  custom_memory: string
  version: number
}

/** 记忆类型列表项 */
export interface MemoryTypeItem {
  /** 标签名（如 MEMORY.md, TOOLS.md） */
  name: string
  /** 接口路径 */
  path: string
}

/** 全量替换 Agent 记忆请求 */
export interface ReplaceAgentMemoryRequest {
  /** JSON: MemoryItem[] */
  items: string
}

/** 全量替换 Agent 工具教训请求 */
export interface ReplaceAgentToolLessonsRequest {
  /** JSON: ToolLessonItem[] */
  lessons: string
}

/** 全量替换用户全局记忆请求 */
export interface ReplaceUserMemoryRequest {
  /** 职位 */
  position?: string
  /** 期望风格 */
  style?: string
  /** 智能记忆（纯文本或 JSON: MemoryItem[]） */
  smart_memory?: string
  /** 自定义记忆（纯文本或 JSON: MemoryItem[]） */
  custom_memory?: string
}

/** 导入用户记忆请求 */
export interface ImportUserMemoryRequest {
  /** 自由文本内容 */
  content: string
}
