import type { ReactNode } from 'react'
import { Tag } from 'antd'
import { CANONICAL_TYPE_LABELS } from './constants'

export function confidenceLabel(value?: number): ReactNode {
  const text = typeof value === 'number' ? `${Math.round(value * 100)}%` : '—'
  return (
    <Tag variant="filled" className="!m-0 !bg-[#E6EEFF]  !text-[#2563EB] py-0.5 !px-2 !text-xs">
      置信度 {text}
    </Tag>
  )
}

export function cognitionTypeLabel(value?: string): ReactNode {
  const label = CANONICAL_TYPE_LABELS[value || '']
  if (!label) return null
  return (
    <Tag variant="filled" className="!m-0  !bg-[#FFF6F2] !px-2 py-0.5 !text-xs !text-[#FF5C2C]">
      {label}
    </Tag>
  )
}

const SOURCE_TYPE_TAG: Record<string, { label: string; className: string }> = {
  boss_authored: { label: '自行添加', className: '!bg-[#E8FFF7] !text-[#10B981]' },
  boss_confirmed: { label: '智能生成', className: '!bg-[#E6EEFF] !text-[#2563EB]' },
  auto_confirmed: { label: '智能生成', className: '!bg-[#E6EEFF] !text-[#2563EB]' },
  meeting_extraction: { label: '智能生成', className: '!bg-[#E6EEFF] !text-[#2563EB]' },
  external_import: { label: '外部导入', className: '!bg-[#F0F1F3] !text-[#677180]' },
  imported: { label: '外部导入', className: '!bg-[#F0F1F3] !text-[#677180]' },
}

export function sourceTypeLabel(value?: string): ReactNode {
  const config = SOURCE_TYPE_TAG[value || ''] || { label: '智能生成', className: '!bg-[#E6EEFF] !text-[#2563EB]' }
  return (
    <Tag variant="filled" className={`!m-0 !px-2 py-0.5 !text-xs ${config.className}`}>
      {config.label}
    </Tag>
  )
}

export function sourceFileLabel(fileId?: string | number, fileName?: string) {
  if (fileName) {
    let title = fileName
    while (/\.(md|markdown|m4a|webm|mp3|wav)$/i.test(title)) {
      title = title.replace(/\.(md|markdown|m4a|webm|mp3|wav)$/i, '')
    }
    return title
  }
  if (fileId) return `文件 ${fileId}`
  return '来源会议'
}

const LIFECYCLE_TAG: Record<string, { label: string; className: string }> = {
  boss_authored: { label: '自动确认', className: '!bg-[#F3EDFF] !text-[#7948EA]' },
  boss_confirmed: { label: '手动确认', className: '!bg-[#EEF4FF] !text-[#3567B7]' },
  auto_confirmed: { label: '自动确认', className: '!bg-[#F3EDFF] !text-[#7948EA]' },
}

export function lifecycleLabel(value?: string): ReactNode {
  const config = LIFECYCLE_TAG[value || '']
  if (!config || value === 'boss_authored') return null
  return (
    <Tag variant="filled" className={`!m-0 !px-2 py-0.5 !text-xs ${config.className}`}>
      {config.label}
    </Tag>
  )
}
