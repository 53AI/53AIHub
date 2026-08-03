import { Dropdown, SvgIcon } from '@km/shared-components-react'
import { DownOutlined } from '@ant-design/icons'
import type { AgentPreviewModelOption } from '../../hooks/useAgentPreviewSender'

export interface PreviewModelSelectorProps {
  options: AgentPreviewModelOption[]
  selectedId: string
  onChange: (id: string) => void
  /**
   * 翻译函数：将 model.label（如 'chat.fast_response'）解析为本地化文案。
   * 不传则回退到 label 原文。
   */
  t?: (key: string, params?: Record<string, any>) => string
}

const SELECTED_COLOR = 'text-[#2563EB]'
const DEFAULT_COLOR = 'text-[#1D1E1F]'

/**
 * 模型选择器（仅样式）。
 *
 * 视觉对齐前台 `apps/front-react/src/views/knowledge/chat.tsx`：
 * - 触发按钮：图标 + 名称 + 下拉箭头，胶囊形态
 * - 菜单项：图标 + 名称 + 勾选，匹配态使用品牌色
 * - 无选项时返回 null
 * - 无当前选中时显示 'chat.select_model' 占位
 */
export function PreviewModelSelector({ options, selectedId, onChange, t }: PreviewModelSelectorProps) {
  if (options.length === 0) return null

  const translate = t || ((key: string) => key)
  const current = options.find((o) => o.id === selectedId) || options[0]
  const currentLabel = translate(current.label)

  return (
    <div className="flex items-center gap-2">
      <Dropdown
        menu={{
          items: options.map((o) => ({
            key: o.id,
            label: (
              <div
                className={`w-full h-9 flex items-center gap-2 ${o.id === selectedId ? SELECTED_COLOR : DEFAULT_COLOR}`}
              >
                <SvgIcon name={o.icon} />
                <span className="text-sm whitespace-nowrap">{translate(o.label)}</span>
                {o.id === selectedId && <SvgIcon name="check-one" />}
              </div>
            ),
          })),
          onClick: ({ key }) => onChange(String(key)),
        }}
        trigger={['click']}
        placement="bottom"
      >
        <div
          role="button"
          tabIndex={0}
          data-testid="preview-model-selector"
          className="h-8 px-4 flex items-center gap-1 rounded-full border border-[#E3EEFF] bg-[#F3F8FF] cursor-pointer text-[#2563EB]"
        >
          <SvgIcon name={current.icon} />
          <span className="text-sm whitespace-nowrap">{currentLabel}</span>
          <div className="size-4 flex items-center justify-center">
            <DownOutlined style={{ fontSize: 14 }} />
          </div>
        </div>
      </Dropdown>
    </div>
  )
}

export default PreviewModelSelector