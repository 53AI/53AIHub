/**
 * Sender 组件类型定义
 * Props 分组设计：inputState, fileUpload, mention, skill, ui, slots
 */

import type { ReactNode, CSSProperties } from 'react'

// ==================== 基础类型 ====================

/** 文件上传结果 */
export interface FileUploadResult {
  id: string
  url: string
  name: string
  size: number
  mime_type: string
}

/** 上传文件状态 */
export interface UploadFile {
  id?: string
  vid?: string  // 内部标识符
  name: string
  size: number
  mime_type: string
  status: 'uploading' | 'done' | 'error'
  url?: string
  preview_key?: string
  raw?: File
  error?: string  // 错误信息
}

/** @ 提及 - 下拉建议项 */
export interface MentionDocItem {
  id: string
  name: string
  icon?: string
  meta?: string
  iconText?: string
  url?: string
  library_id?: string
  upload_file_id?: number
  file_size?: number
  file_mime?: string
  isfolder?: boolean
  upload_file?: {
    size: number
    mime_type: string
  } | null
}

/** @ 提及 - 已选择项（带 UI 状态） */
export interface MentionLinkItem extends MentionDocItem {
  ui?: { active: boolean }
  path?: string
  rawData?: any
  source?: 'knowledge' | 'uploads' | 'ai-generated' | 'recordings'
  islibrary?: boolean
  isspace?: boolean
}

/** 技能项 */
export interface SkillItem {
  id?: string
  label: string
  display_name?: string
  skill_name?: string
  description?: string
  logo?: string
  icon?: string
  /** 技能绑定类型：builtin-内置技能，user-用户技能 */
  bind_type?: 'builtin' | 'user'
}

/** 发送数据 */
export interface SenderSendData {
  innerHTML?: string
  textContent: string
  pureTextContent?: string
  atList?: MentionLinkItem[]
  skillList?: string[]
  /**
   * 选中的技能完整信息(包含 display_name 与 skill_name)。
   * 与 skillList 同步发送,但保留了 skill_name(后端路由用)与 display_name(展示用)的区分。
   * 新代码优先使用 selectedSkills;skillList 保留向后兼容。
   */
  selectedSkills?: Array<{ display_name: string; skill_name?: string }>
  files?: UploadFile[]
}

// ==================== Feature 分组 ====================

/** 输入状态 */
export interface InputStateFeature {
  /** 是否禁用输入 */
  disabled?: boolean
  /** 禁用原因（显示在输入框下方） */
  disabledReason?: string
  /** 是否禁用停止按钮 */
  stopDisabled?: boolean
}

/** 文件上传功能 */
export interface FileUploadFeature {
  /** 是否启用文件上传 */
  enabled?: boolean
  /** 接受的文件类型 */
  acceptTypes?: string
  /** 最大文件大小（字节），默认 50MB */
  maxFileSize?: number
  /** 是否启用拖拽上传 */
  enableDrag?: boolean
  /** 是否启用粘贴上传 */
  enablePaste?: boolean
  /** 是否允许多文件 */
  allowMultiple?: boolean
  /** 是否允许仅文件发送 */
  allowSendWithFiles?: boolean
  /** 自定义上传函数 */
  request?: (file: File) => Promise<FileUploadResult>
  /** 已上传文件列表（受控） */
  fileList?: UploadFile[]
  /** 文件变化回调 */
  onFileChange?: (files: UploadFile[]) => void
}

/** @ 提及功能 */
export interface MentionFeature {
  /** 是否启用 @ 提及 */
  enabled?: boolean
  /** 是否禁用 @ 功能 */
  disabled?: boolean
  /** 触发字符，默认 "@" */
  triggerCode?: string
  /** 最大选择数量，默认 20 */
  maxCount?: number
  /** 输入占位符 */
  placeholder?: string
  /** 输入占位符样式 */
  placeholderStyle?: string | CSSProperties
  /** 按钮提示文字 */
  tooltip?: string
  /** 是否在编辑器内创建链接 */
  createLinkInEditor?: boolean
  /** 是否启用增强版下拉（多来源选择） */
  enhanced?: boolean
  /** 是否有知识库 */
  hasKnowledgeBase?: boolean
  /** 是否允许选择知识库 */
  allowSelectLibrary?: boolean
  /** 是否允许选择空间 */
  allowSelectSpace?: boolean
  /** 知识库上下文 */
  libraryContext?: { id: string; space_id: string }

  // === 数据注入 ===
  /** 已选择的文件列表 */
  list?: MentionLinkItem[]
  /** 下拉建议列表 */
  suggestions?: MentionDocItem[]
  /** 最近访问列表 */
  recentList?: MentionDocItem[]
  /** 搜索关键词（受控） */
  searchKeyword?: string
  /** 搜索加载状态 */
  searchLoading?: boolean

  // === 回调 ===
  /** 搜索回调 */
  onSearch?: (keyword: string) => void
  /** 选择回调 */
  onSelect?: (item: MentionDocItem) => void
  /** 删除回调 */
  onRemove?: (item: MentionLinkItem) => void
  /** 打开知识库弹窗 */
  onOpenLibrary?: () => void
  /** 选择文件回调（从外部弹窗选择时） */
  // 扩展第四个参数 wikis:支持动态知识(空间/页面)选中回调,
  // 由 apps/front-react/src/components/Space/dialog.tsx onConfirm 透传。
  onSelectFiles?: (files: MentionDocItem[], libraries?: any[], spaces?: any[], wikis?: any[]) => void
  /**
   * 点击 @ 按钮时,chip 插入前调用的回调。
   * 对齐原版 Sender.tsx line 1791 的 afterCalloutMentionInput,
   * 父组件可在 chip 插入前做副作用(例如:加载最近文件、收起侧边栏等)。
   */
  afterCalloutMentionInput?: () => void
  /**
   * 技能标签被删除时回调(由 hook 内部、handleEditorInput 触发)。
   * 对齐原版 Sender.tsx line 957-958 的 onRemoveSkill 链。
   */
  onRemoveSkill?: () => void
}

/** / 技能功能 */
export interface SkillFeature {
  /** 是否启用 / 技能 */
  enabled?: boolean
  /** 触发字符，默认 "/" */
  triggerCode?: string
  /** 按钮提示文字 */
  tooltip?: string

  // === 数据注入 ===
  /** 已选择的技能列表 */
  list?: SkillItem[]
  /** 下拉建议列表 */
  suggestions?: SkillItem[]
  /** 搜索关键词（受控） */
  searchKeyword?: string
  /** 搜索加载状态 */
  searchLoading?: boolean

  // === 回调 ===
  /** 搜索回调 */
  onSearch?: (keyword: string) => void
  /** 选择回调 */
  onSelect?: (skill: SkillItem) => void
  /** 删除回调 */
  onRemove?: () => void
  /** 打开技能库 */
  onOpenLibrary?: () => void
}

/** UI 配置 */
export interface UIConfig {
  /** 是否移动端 */
  isMobile?: boolean
  /** 是否显示光标 */
  showCaret?: boolean
  /** 是否允许 blur */
  canBlur?: boolean
  /** 占位符样式 */
  placeholderStyle?: string | CSSProperties
  /** 设备信息 */
  device?: object
  /** 聚焦时是否需要修复位置 */
  needFixPositionWhenFocus?: boolean
  /** 操作按钮位置 */
  actionPosition?: 'actions' | 'extras'
}

// ==================== Slot Props ====================

/** 下拉弹窗 Slot Props */
export interface MentionDropdownSlotProps {
  suggestions: MentionDocItem[]
  recentList?: MentionDocItem[]
  searchKeyword: string
  searchLoading: boolean
  selectedIndex: number
  onSelect: (item: MentionDocItem) => void
  onSearchChange: (keyword: string) => void
  onOpenLibrary?: () => void
  /**
   * 仅关闭下拉,不触碰编辑器里的 chip。
   * 适用于关闭按钮、"切换到别的功能"等场景。
   */
  onClose?: () => void
  /**
   * 取消整个 @ 输入:关闭下拉 + 把 chip 还原成普通字符 + 把焦点放回编辑器。
   * Esc 键必须用这个(否则 chip 仍以 mention-input 形式留在 DOM)。
   */
  onCancel?: () => void
  style: CSSProperties
  /** 是否增强版模式 */
  enhanced?: boolean
  hasKnowledgeBase?: boolean
}

export interface SkillDropdownSlotProps {
  suggestions: SkillItem[]
  searchKeyword: string
  searchLoading: boolean
  selectedIndex: number
  onSelect: (skill: SkillItem) => void
  onSearchChange: (keyword: string) => void
  onOpenLibrary?: () => void
  /**
   * 仅关闭下拉,不触碰编辑器里的 chip。
   */
  onClose?: () => void
  /**
   * 取消整个 / 输入:关闭下拉 + 把 chip 还原成普通字符 + 把焦点放回编辑器。
   */
  onCancel?: () => void
  style: CSSProperties
}

/** 文件列表 Slot Props */
export interface FileListSlotProps {
  files: UploadFile[]
  onRemove: (index: number) => void
}

/** 链接列表 Slot Props */
export interface LinkListSlotProps {
  links: MentionLinkItem[]
  collapsed?: boolean
  onRemove: (item: MentionLinkItem) => void
  onToggleCollapse?: () => void
}

// ==================== Slots ====================

export interface SenderSlots {
  // === 编辑器区域 ===
  /** 输入框前的内容（技能标签等） */
  inputBefore?: ReactNode
  /** 输入框后的内容 */
  inputAfter?: ReactNode

  // === 列表区域 ===
  /** 自定义文件列表 */
  fileList?: (props: FileListSlotProps) => ReactNode
  /** 自定义链接列表 */
  linkList?: (props: LinkListSlotProps) => ReactNode
  /** 链接列表下方区域（不受 links 是否为空限制） */
  linkListBelow?: ReactNode

  // === 操作栏区域 ===
  /** 左侧扩展区（@ 按钮、技能按钮等） */
  extrasLeft?: ReactNode
  /** 右侧扩展区 */
  extrasRight?: ReactNode
  /** 完全自定义操作栏（替换默认） */
  actionBar?: ReactNode

  // === 下拉弹窗 ===
  /** 自定义 @ 下拉弹窗 */
  mentionDropdown?: (props: MentionDropdownSlotProps) => ReactNode
  /** 自定义 / 技能下拉弹窗 */
  skillDropdown?: (props: SkillDropdownSlotProps) => ReactNode

  // === 整体布局 ===
  /** 顶部区域 */
  header?: ReactNode
  /** 底部区域 */
  footer?: ReactNode
}

// ==================== 样式配置 ====================

export interface SenderClassNames {
  root?: string
  editor?: string
  fileList?: string
  linkList?: string
  actionBar?: string
  sendButton?: string
  stopButton?: string
}

// ==================== 主 Props ====================

export interface SenderProps {
  // === 核心 ===
  /** 输入值 */
  value?: string
  /** 值变化回调 */
  onChange?: (value: string) => void
  /** 发送回调 */
  onSend?: (data: SenderSendData) => void
  /** 停止回调 */
  onStop?: () => void
  /** 是否正在流式输出 */
  loading?: boolean
  /** 占位符 */
  placeholder?: string
  /** 最大输入长度 */
  maxLength?: number
  /** 是否回车发送，默认 true */
  sendOnEnter?: boolean

  // === 功能分组 ===
  /** 输入状态 */
  inputState?: InputStateFeature
  /** 文件上传 */
  fileUpload?: FileUploadFeature
  /** @ 提及 */
  mention?: MentionFeature
  /** / 技能 */
  skill?: SkillFeature
  /** UI 配置 */
  ui?: UIConfig

  // === 其他回调 ===
  /** 输入变化回调（返回完整数据） */
  onInput?: (data: SenderSendData) => void
  /** 聚焦回调 */
  onFocus?: () => void
  /** 失焦回调 */
  onBlur?: () => void

  // === UI 插槽 ===
  slots?: SenderSlots

  // === 样式 ===
  className?: string
  style?: CSSProperties
  classNames?: SenderClassNames
}

// ==================== Ref ====================

export interface SenderRef {
  /** 插入文本 */
  insertText: (text: string) => void
  /** 发送 */
  send: () => void
  /** 强制聚焦 */
  focus: (moveEnd?: boolean) => void
  /** 清空输入 */
  clear: () => void
  /** 清空链接列表 */
  clearLinks: () => void
  /** 设置链接列表 */
  setLinks: (links: MentionLinkItem[]) => void
  /** 设置输入值 */
  setPrompt: (text: string) => void
  /** 清空编辑器（保留链接） */
  clearEditor: () => void
  /** 清空上传文件 */
  clearFiles: () => void
  /** 插入技能标签 */
  insertSkill: (skill: SkillItem) => void
  /** 清空技能标签 */
  clearSkills: () => void
  /** 触发 @ 提及 */
  triggerMention: () => void
  /** 触发技能选择 */
  triggerSkill: () => void
  /**
   * 外部 Dialog(SpaceDialog / MyFilesDialog)选中文件后调用:
   * 清理编辑器中的 mention-input 并关闭下拉框。
   * 对齐原版 Sender:onSelectFiles 后的副作用。
   */
  quitMentionInput: () => void
}