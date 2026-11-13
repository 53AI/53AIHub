/**
 * 认知模型路由入口：直接使用新版实现（index.new.tsx）。
 *
 * 旧版实现（index.old.tsx）保留在仓库中暂不删除；两版共享 ./components
 * 下的全部组件，差异仅在页面布局与文案（新版无“领域认知”区块标题，
 * 见 DomainSection 的 showHeader）。
 */
import { RecordingCognitionModelView as CognitionViewNew } from './index.new'

export function RecordingCognitionModelView() {
  return <CognitionViewNew />
}

export default RecordingCognitionModelView
