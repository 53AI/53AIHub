/** 生长模式 */
export type WikiCategoryGrowthMode = "smart" | "fixed";

/** 启用状态 */
export type WikiCategoryStatus = "enabled" | "disabled";

/** 结构大纲章节（fixed 模式数据大纲，由编辑器维护） */
export interface WikiTemplateSection {
  title: string;
  /** 标题级别：1 ~ 6 */
  level: number;
  description?: string;
}

/** 空间 Wiki 分类（53AIHub 页面生产规则） */
export interface WikiCategory {
  id: string;
  name: string;
  description: string;
  /** 主目标实体，收敛为 6 大类别名（兼容中文别名，接口规范化为英文枚举） */
  target_entity_type: string;
  /** 可选，稳定的业务类型名 */
  okf_type?: string;
  growth_mode: WikiCategoryGrowthMode;
  /** smart 模式使用的写作风格文案 */
  style_prompt?: string;
  /** 仅前端回显用（默认「自定义」），生成仍使用 style_prompt 文案 */
  style_prompt_title?: string;
  /** 图谱穿透深度：1 / 2 / 3 */
  graph_depth?: number;
  /** 大模型发散创造力：0 ~ 1 */
  creativity?: number;
  /** 是否自动生成实体 Markdown 锚点链接 */
  anchor_links_enabled?: boolean;
  /** fixed 模式使用的 Markdown 模板 */
  template_markdown?: string;
  /** fixed 模式数据大纲（title/level/description 章节表） */
  template_sections?: WikiTemplateSection[];
  /** 是否严格字段填充（仅 fixed 模式生效） */
  strict_fill?: boolean;
  status: WikiCategoryStatus;
  /** 越小越靠前 */
  sort?: number;
  created_time?: number;
  updated_time?: number;
}

export interface WikiCategoryListResponse {
  items: WikiCategory[];
  total: number;
  offset: number;
  limit: number;
}

/** AI 生成分类草稿响应：服务端按空间名称/简介 + growth_mode 生成草稿 */
export interface WikiCategoryDraftResponse {
  categories: WikiCategory[];
}

export interface WikiCategoryListRequest {
  status?: WikiCategoryStatus;
  keyword?: string;
  offset?: number;
  limit?: number;
}

export interface WikiCategoryUpsertRequest {
  name: string;
  description: string;
  target_entity_type: string;
  okf_type?: string;
  growth_mode: WikiCategoryGrowthMode;
  style_prompt?: string;
  style_prompt_title?: string;
  graph_depth?: number;
  creativity?: number;
  anchor_links_enabled?: boolean;
  template_markdown?: string;
  template_sections?: WikiTemplateSection[];
  strict_fill?: boolean;
  status?: WikiCategoryStatus;
  sort?: number;
}

/** 写作风格预设 */
export interface WikiStylePreset {
  title: string;
  prompt: string;
}

/** 目标实体类型（分类可选的主目标实体枚举） */
export interface WikiTargetType {
  /** 规范类型值，如 "Person" / "Organization" / "Concept" */
  type: string;
  /** 展示文案，如 "人物" / "组织" */
  label: string;
  /** 同义别名（中英文），用于实体识别 */
  aliases?: string[];
  /** 该类型含义说明 */
  description?: string;
}