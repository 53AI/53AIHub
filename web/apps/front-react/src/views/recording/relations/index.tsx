import { RecordingMemoryHomeView } from '../memory'

/**
 * /recording/relations —— "关系"子路由。
 *
 * 复用经营记忆的实体页面：页面完全由 schema 驱动（类型 tab / 文案 / 属性全部来自
 * schema 接口），这里仅把 schema 分类切换为 relation，即可展示关系分类下的实体。
 * 两处差异：标题/描述文案、schema 的 category 参数。
 *
 * 后续关系模块需要独立演化（专属交互/图谱等）时，再从 memory 拆分专属实现。
 */
export function RecordingRelationsView() {
  return (
    <RecordingMemoryHomeView
      category="relation"
      title="关系"
      description="提取对话关键信息，抽取人物和企业"
    />
  )
}

export default RecordingRelationsView
