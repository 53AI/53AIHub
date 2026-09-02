import { SvgIcon } from '@km/shared-components-react'

type Variant = 'persisted' | 'staged'

type Props = {
  variant: Variant
  time: string
  sourceLabel: string
  body: string
  typeLabel: string
  // 「相关」section 的事实卡片渲染。
  // 三种用法:
  //   - 已持久化(variant="persisted",onDelete 可选):深蓝圆点 + hover 删除按钮
  //   - 暂存新增(variant="staged",onDelete 有):浅蓝圆点 + hover 移除按钮
  //   - 只读详情(无 onDelete):无 group / 无删除按钮 / 内卡片不留 pr-10
  // 数据由调用方投影后传入,组件不感知原始字段名(后端 schema 调整只改调用方一处)。
  onDelete?: () => void
  deleteAriaLabel?: string
}

export function FactCard({
  variant,
  time,
  sourceLabel,
  body,
  typeLabel,
  onDelete,
  deleteAriaLabel,
}: Props) {
  const dotColor = variant === 'persisted' ? 'border-blue-500' : 'border-blue-300'
  const interactive = !!onDelete
  return (
    <div className={`relative pl-5 ${interactive ? 'group' : ''}`}>
      <span className={`absolute left-0 top-1 h-3 w-3 rounded-full border-2 bg-white shadow-sm ${dotColor}`} />
      <div className="mb-2 flex items-center gap-2 text-sm text-[#9CA3AF] min-w-0">
        <span className="shrink-0">{time}</span>
        <span className="shrink-0">·</span>
        <span className="flex-1 min-w-0 truncate" title={sourceLabel}>{sourceLabel}</span>
      </div>
      <div className={`rounded-xl bg-slate-50 p-3 ${interactive ? 'relative pr-10' : ''}`}>
        <p className="whitespace-pre-line break-words text-sm leading-6 text-[#1D1E1F]">{body}</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="inline-block rounded bg-[#F7F0EF] px-2 py-0.5 text-xs text-[#FF5C2C]">{typeLabel}</span>
        </div>
        {interactive && (
          <button
            type="button"
            aria-label={deleteAriaLabel ?? '删除'}
            title={deleteAriaLabel ?? '删除'}
            onClick={onDelete}
            className="invisible absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[#9CA3AF] transition-opacity hover:bg-slate-200 hover:!text-[#FF4D4F] group-hover:visible"
          >
            <SvgIcon name="delete" size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
