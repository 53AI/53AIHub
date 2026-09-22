import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Modal, Select } from 'antd'
import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { getSimpleDateFormatString } from '@km/shared-utils'
import { buildUrl } from '@/utils/router'
import recordingApi from '@/api/modules/recording'
import type { RecordingCognition, RecordingCognitionDetail } from '@/api/modules/recording/types'
import {
  cognitionTypeLabel,
  confidenceLabel,
  lifecycleLabel,
  sourceFileLabel,
  sourceTypeLabel
} from '../utils'
import { useRemoveCognition } from './useRemoveCognition'

interface CognitionDetailModalProps {
  open: boolean
  /** 打开时所需的目标认知条目（取其 id 拉取详情） */
  target: RecordingCognition | null
  scopeLabel?: string
  onClose: () => void
  onEdit: (detail: RecordingCognitionDetail) => void
}

export function CognitionDetailModal({ open, target, scopeLabel, onClose, onEdit }: CognitionDetailModalProps) {
  const remove = useRemoveCognition()
  const [detail, setDetail] = useState<RecordingCognitionDetail | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<number>(0)
  const requestRef = useRef(0)

  // 打开时按目标 id 拉取详情
  useEffect(() => {
    if (!open || !target) {
      setDetail(null)
      setSelectedVersion(0)
      return
    }
    const requestId = ++requestRef.current
    setDetail(null)
    recordingApi.getCognition(target.id).then((result) => {
      if (requestId === requestRef.current) {
        setDetail(result)
        setSelectedVersion(result.current_version)
      }
    }).catch(() => {}) // 错误已由 handleError 全局提示，这里仅避免 unhandled rejection
}, [open, target])

  const confirmExpire = () => {
    if (!detail) return
    remove(detail, { onDone: onClose })
  }

  // 版本下拉项：按 version 倒序，保证 current_version 一定在列表中
  const versionOptions = useMemo(() => {
    if (!detail) return []
    const fromArray = [...detail.versions].sort((left, right) => right.version - left.version)
    const options = fromArray.map((version) => ({
      value: version.version,
      label: `V${version.version}`,
    }))
    if (!fromArray.some((version) => version.version === detail.current_version)) {
      options.unshift({ value: detail.current_version, label: `V${detail.current_version}` })
    }
    return options
  }, [detail])

  // 是否正查看历史版本（非当前版本）：是则禁用编辑/删除
  const { isHistorical, display, timeText } = useMemo(() => {
    if (!detail) return { isHistorical: false, display: null as RecordingCognitionDetail | null, timeText: '' }
    const historical =
      selectedVersion !== detail.current_version
        ? detail.versions.find((version) => version.version === selectedVersion)
        : undefined
    const isHist = !!historical
    const formatTime = (value?: number) =>
      getSimpleDateFormatString({ date: value, format: 'YYYY年MM月DD日 hh:mm' })
    return {
      isHistorical: isHist,
      timeText: isHist && historical ? formatTime(historical.created_at_unix) : formatTime(detail.updated_time),
      display: {
        ...detail,
        title: historical?.title ?? detail.title,
        statement: historical?.statement ?? detail.statement,
        cognition_type: historical?.cognition_type ?? detail.cognition_type,
        evidence_refs: isHist && historical?.evidence_refs?.length ? historical.evidence_refs : detail.evidence_refs,
        source_file_id: historical?.source_file_id ?? detail.source_file_id,
        source_file_name: historical?.source_file_name ?? detail.source_file_name,
        current_version: selectedVersion,
      },
    }
  }, [detail, selectedVersion])

  return (
    <Modal
      width={680}
      title={scopeLabel || '认知详情'}
      open={open}
      footer={
        detail ? (
          <div className="flex justify-between">
            <Button danger type="default" icon={<DeleteOutlined />} onClick={confirmExpire} disabled={detail.status === 'expired' || isHistorical}>
              删除
            </Button>
            <Button type="primary" icon={<EditOutlined />} onClick={() => onEdit(detail)} disabled={isHistorical}>
              编辑
            </Button>
          </div>
        ) : null
      }
      onCancel={onClose}
      destroyOnHidden
    >
      {display && (
        <div className="space-y-5">
          <section>
            <div className="flex items-center gap-2">
              <div className="flex-1 text-base font-medium text-[#1D1E1F] truncate">{display.title}</div>
              {lifecycleLabel(display.source_type)}
            </div>
            <div className="mt-2 flex items-center gap-2">
              {cognitionTypeLabel(display.cognition_type)}
              <Select
                size="small"
                variant="borderless"
                className="!text-xs text-[#2563EB]"
                style={{ minWidth: 46 }}
                value={selectedVersion}
                onChange={setSelectedVersion}
                popupMatchSelectWidth={false}
                options={versionOptions}
                listHeight={Math.min(versionOptions.length * 36, 216)}
              />
              <span className="text-xs text-[#9CA3AF]">{timeText}</span>
            </div>
            <div className="mt-2 text-sm text-[#1D1E1F] whitespace-pre-wrap">{display.statement}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {sourceTypeLabel(display.source_type)}
              {confidenceLabel(display.confidence)}
            </div>
          </section>

          <section>
            <div className="mb-2 text-sm font-medium text-[#1D1E1F]">相关事实</div>
            {display.evidence_refs?.length ? (
              <div className="space-y-2">
                {display.evidence_refs.map((evidence, index) => (
                  <button
                    key={`${evidence.source_file_id}-${index}`}
                    type="button"
                    title="打开对应录音"
                    onClick={() => window.open(buildUrl(`/recording/preview/${evidence.source_file_id}`), '_blank')}
                    className="flex w-full items-center justify-between gap-3 rounded-lg bg-[#F7F8FA] p-3 text-left text-sm text-[#1D1E1F] transition-colors hover:bg-[#F0F4FB]"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2 truncate text-[#1D1E1F]">
                      {sourceFileLabel(evidence.source_file_id, evidence.source_file_name)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg bg-[#F7F8FA] px-3 py-3 text-xs text-[#9AA6B6]">暂无相关事实</div>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}

export default CognitionDetailModal