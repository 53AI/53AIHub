/**
 * ProcessFlow 组件类型定义
 */

import type { ProcessRecord } from '../../types/message';

/** 流程类型 */
export type ProcessFlowType = 'task' | 'skill' | 'none';

/** 流程步骤状态 */
export type StepStatus = 'pending' | 'running' | 'completed';

/** SSE 步骤状态 */
export type SSEStepStatus = 'start' | 'completed' | 'success' | 'streaming';

// Re-export ProcessRecord for backward compatibility
export type { ProcessRecord } from '../../types/message';

/** 知识源数据（来自 knowledge_search） */
export interface KnowledgeSource {
  chunk_id?: string;
  chunk_type?: string;
  content?: string;
  file_id?: string | number;
  file_name?: string;
  file_path?: string;
  knowledge_base_id?: string | number;
  knowledge_base_name?: string;
  library_id?: string | number;
  library_name?: string;
  library_icon?: string;
  reference_id?: string;
  score?: number;
  source_key?: string;
  space_id?: string;
  space_name?: string;
  url?: string;
}

/** 翻译函数类型 */
export type TranslateFn = (key: string) => string;

/** ProcessFlowHeader 组件 Props */
export interface ProcessFlowHeaderProps {
  /** 流程记录数据（来自 process.step） */
  processRecords?: ProcessRecord[];
  /** 是否正在流式输出 */
  streaming?: boolean;
  /** answer 是否有内容 */
  hasContent?: boolean;
  /** 打开思考知识库侧边栏（Task 流程专用） */
  onOpenKnow?: () => void;
  /** 点击源文件跳转 */
  onSourceClick?: (source: KnowledgeSource) => void;
  /** 获取知识检索结果的回调（用于 onOpenKnowledgePanel） */
  getKnowledgeSearchFiles?: () => KnowledgeSource[];
  /** 外部传入的翻译函数（可选，不传则使用内置 i18n） */
  t?: TranslateFn;
}

/** TaskProcessFlow 组件 Props */
export interface TaskProcessFlowProps {
  processRecords?: ProcessRecord[];
  streaming?: boolean;
  hasContent?: boolean;
  onOpenKnow?: () => void;
  /** 点击源文件跳转 */
  onSourceClick?: (source: KnowledgeSource) => void;
}

/** SkillProcessFlow 组件 Props */
export interface SkillProcessFlowProps {
  processRecords?: ProcessRecord[];
  streaming?: boolean;
  hasContent?: boolean;
}
