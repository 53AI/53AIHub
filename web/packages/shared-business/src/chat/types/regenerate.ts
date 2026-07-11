import type { Message, MessageFile, SpecifiedFile, Skill } from "./message";

/**
 * "重新生成回答"参数契约：把 Message 提取为发送所需的字段
 *
 * 覆盖两个场景：
 * - 工作台（IndexChat）：消费 skill + files + specifiedFiles
 * - 知识库（knowledge/chat）：消费 networkSearch + knowledgeGraph + files + specifiedFiles
 */
export interface RegenerateParams {
  /** 去 skill 前缀后的纯文本问题 */
  question: string;
  /** 原始 message.question（保留前缀，便于调试/审计） */
  originalQuestion: string;
  /** 用户上传的文件 */
  files: MessageFile[];
  /** 知识库/空间链接（@提及） */
  specifiedFiles: SpecifiedFile[];
  /** 技能（如有），已从前缀解析 */
  skill?: Skill;
  /** 是否启用联网搜索（由 rag_stats.type 推断） */
  networkSearch?: boolean;
  /** 是否启用知识图谱 */
  knowledgeGraph?: boolean;
  /** 指定的文件内容（高级场景；当前 IndexChat / knowledge/chat 均不消费，
   *  保留供未来"按文件内容重生成"等场景使用） */
  specifiedContent?: string;
  /** 原始消息（兜底） */
  sourceMessage: Message;
}

/** handleRegenerate 的 hook 选项 */
export interface UseChatMessagesRegenerateOptions {
  /** 技能列表（用于解析 skill 前缀） */
  skillList?: any[];
  /** 我的技能列表（用于解析 skill 前缀） */
  mySkillList?: any[];
  /** 是否解析 skill 前缀，默认 true（与 loadMessages 行为一致） */
  parseSkillPrefix?: boolean;
}
