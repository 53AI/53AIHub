/**
 * 开放接口「接入指引」共享模块
 *
 * 提供 <ApiGuide />：三个接入入口按钮（53AI Studio / Dify / Wiki API）+ 指引抽屉。
 * Studio / Dify 图文步骤两端一致，内置在模块中；
 * Wiki 指引与作用域强相关（前台=知识库级、后台=空间级），由调用方注入标题与内容。
 */
export { ApiGuide } from './ApiGuide'
export type { ApiGuideProps, ApiGuideLabels } from './ApiGuide'
export type { ApiGuideType, ApiGuideContentItem } from './types'
