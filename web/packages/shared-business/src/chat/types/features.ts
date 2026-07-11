/**
 * 共享的 Feature 类型定义
 * 只包含在 ChatView 和 ChatMessages 中完全相同的类型
 */

export interface AgentRecommendFeature {
  /** 是否显示相关场景 */
  showRelatedScene?: boolean;
  /** 跳转到下一个智能体 */
  onNavigateNext?: (item: any, params: Record<string, string>) => void;
  /** 刷新当前智能体 */
  onRefresh?: () => void;
}

export interface AuthTagsSlotProps {
  userGroupIds: number[];
}