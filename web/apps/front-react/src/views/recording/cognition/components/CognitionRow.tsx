import type { ReactNode } from 'react'
import { Typography } from 'antd'
import { ClockCircleOutlined, LinkOutlined } from '@ant-design/icons'
import { getSimpleDateFormatString } from '@km/shared-utils'
import type { RecordingCognition, RecordingCognitionCandidate } from '@/api/modules/recording/types'
import {
  cognitionTypeLabel,
  confidenceLabel,
  lifecycleLabel,
  sourceFileLabel,
  sourceTypeLabel,
} from '../utils'

/** 已确认认知与待确认候选共有的行字段子集，两者都可直接传入。 */
type CognitionRowItem = RecordingCognition | RecordingCognitionCandidate

interface CognitionRowProps<T extends CognitionRowItem> {
  item: T
  /** 右侧动作区（已确认=编辑/删除图标，待确认=编辑/忽略/确认） */
  actions: ReactNode
  /** 传入则整行可点击（如打开详情） */
  onClick?: (item: T) => void
  /** 展示「自动/手动确认」来源标签；仅已确认列表需要，待确认候选不应出现 */
  showLifecycle?: boolean
  placement?: string
}

/**
 * 认知列表行的统一渲染：头部标签、标题 + 描述、右侧动作、底部来源与编辑时间。
 *
 * 已确认列表（CognitionDrawer）与待确认列表（PendingCognitionDrawer）共用，避免两处各写一份。
 * 描述超出一行用 antd Typography 原生省略，溢出时才显示 tooltip。
 */
export function CognitionRow<T extends CognitionRowItem>({ item, actions, onClick, showLifecycle, placement }: CognitionRowProps<T>) {
  return (
    <div
      className={`group rounded-xl bg-[#F7F8FA] p-4 ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick ? () => onClick(item) : undefined}
    >
      <div className="flex items-center gap-2">
        {(placement === 'right' ? true : item.layer === 'situational') && cognitionTypeLabel(item.cognition_type)}
        {sourceTypeLabel(item.source_type)}
        {confidenceLabel(item.confidence)}
        <div className="flex-1"></div>
        {showLifecycle && lifecycleLabel(item.source_type)}
      </div>
      <div className="flex items-center gap-3 mt-3">
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-medium text-[#1D1E1F]">{item.title}</div>
          <Typography.Text ellipsis={{ tooltip: item.statement }} className="mt-1 block text-sm text-[#6B7280]">
            {item.statement}
          </Typography.Text>
        </div>
        <span className="ml-auto inline-flex items-center gap-2">{actions}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#EEF1F6] pt-2 text-xs text-[#9CA3AF]">
        {item.source_file_name && (
          <span className="inline-flex min-w-0 items-center gap-1 truncate">
            <LinkOutlined />
            来源：{sourceFileLabel(item.source_file_id, item.source_file_name)}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <ClockCircleOutlined />
          最近编辑：{getSimpleDateFormatString({ date: item.updated_time || item.created_time, format: 'YYYY-MM-DD hh:mm' })}
        </span>
      </div>
    </div>
  )
}

export default CognitionRow
