/**
 * 组件统一导出
 * 保持向后兼容的导入路径
 */

// shared 组件
export { AgentType } from './shared/AgentType'
export { AgentInfo } from './shared/AgentInfo'
export { UseScope } from './shared/UseScope'
export { ExpandConfig } from './shared/ExpandConfig'

// config 组件
export { BaseConfig } from './config/BaseConfig'
export { LimitConfig } from './config/LimitConfig'
export { FieldInput } from './config/FieldInput'
export { FieldInputSetting } from './config/FieldInputSetting'
export { RelateAgents } from './config/RelateAgents'
export { RelateAgentsDialog } from './config/RelateAgentsDialog'
export { RelateAgentsSetting } from './config/RelateAgentsSetting'

// layout 组件
export { AgentDrawer } from './layout/Drawer'
export { AgentPreview } from './layout/Preview'
export { AgentGuide } from './layout/Guide'

// 类型导出
export type { AgentDrawerRef } from './layout/Drawer'
export type { AgentPreviewRef } from './layout/Preview'
