import { message, Modal } from 'antd'
import { ClockCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { IconAction, SafeImage, SvgIcon } from '@km/shared-components-react'
import { getFormatTimeStamp } from '@km/shared-utils'
import recordingApi from '@/api/modules/recording'
import type { RecordingCognitionDomain } from '@/api/modules/recording/types'
import { DEFAULT_DOMAIN_LOGO } from '../constants'
import { useCognitionContext } from './CognitionContext'

interface DomainSectionProps {
  domains: RecordingCognitionDomain[]
  onOpenDrawer: (domain: RecordingCognitionDomain) => void
  onOpenEdit: (domain: RecordingCognitionDomain) => void
  onOpenCreate: () => void
}

export function DomainSection({ domains, onOpenDrawer, onOpenEdit, onOpenCreate }: DomainSectionProps) {
  const { refreshAfterMutation } = useCognitionContext()

  const confirmRemove = (domain: RecordingCognitionDomain) => {
    const cognitionCount = domain.cognition_count ?? 0
    const pendingCount = domain.pending_count ?? 0
    // 领域下仍有认知或待确认项时不允许删除，避免认知失去归属
    if (cognitionCount > 0 || pendingCount > 0) {
      const reasons: string[] = []
      if (cognitionCount > 0) reasons.push(`${cognitionCount} 条认知`)
      if (pendingCount > 0) reasons.push(`${pendingCount} 条待确认`)
      message.warning(`该领域下还有 ${reasons.join('、')}，请先处理后再删除`)
      return
    }
    Modal.confirm({
      title: `删除领域「${domain.name}」`,
      content: '删除后不可恢复',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await recordingApi.deleteCognitionDomain(domain.id)
        // 删除领域会改变 overview 的 situational_count，主动重拉计数
        await refreshAfterMutation()
      },
    })
  }
  return (
    <section className="mt-8">
      <div className="mb-3">
        <h2 className="text-lg font-medium text-[#1D1E1F]">领域认知</h2>
        <p className="mt-1 text-sm text-[#9CA3AF]">二号总裁基于你最近的会议、决策和经营变化，整理出的领域认知</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div
          role="button"
          tabIndex={0}
          onClick={() => void onOpenCreate()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') void onOpenCreate()
          }}
          className="min-h-[120px] rounded-lg border border-[#E8EEFA] bg-[#F7FAFF] flex justify-center items-center cursor-pointer transition-all duration-300 relative ease-linear hover:shadow-lg"
        >
          <div className="size-10 rounded-lg bg-[#E6EEFF] flex items-center justify-center mr-2">
            <PlusOutlined style={{ fontSize: 16, color: '#2563EB' }} />
          </div>
          <div className="text-sm text-[#2563EB]">新建认知</div>
        </div>
        {domains.map((domain) => {
          return (
            <div
              key={domain.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenDrawer(domain)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onOpenDrawer(domain)
              }}
              className="group flex cursor-pointer flex-col rounded-xl border border-[#E1E6ED] bg-white p-5 text-left shadow-[0_5px_16px_rgba(37,67,112,0.035)] transition-all hover:-translate-y-0.5 hover:border-[#B9CDED] hover:shadow-[0_10px_24px_rgba(37,67,112,0.1)]"
            >
              <div className="flex items-center gap-2.5">
                <SafeImage src={domain.logo || ''} fallback={DEFAULT_DOMAIN_LOGO} round={8} className="size-8 shrink-0 rounded-lg object-cover" />
                <span className="text-base font-medium text-[#1D1E1F] line-clamp-1">{domain.name}</span>
                <span className="ml-auto flex items-center">
                  <IconAction variant="row" title="编辑" onClick={() => void onOpenEdit(domain)}>
                    <EditOutlined />
                  </IconAction>
                  <IconAction variant="row" danger title="删除" onClick={() => confirmRemove(domain)}>
                    <DeleteOutlined />
                  </IconAction>
                </span>
              </div>
              <p className="mt-1 line-clamp-1 text-sm leading-5 text-[#9AA5B5]">{domain.description?.trim() || `--`}</p>

              <div className="mt-3 flex items-center justify-between text-xs text-[#9CA3AF]">
                <span className="inline-flex items-center gap-1">
                  <SvgIcon name="book-one" size={12} />
                  {`${domain.cognition_count} 认知`}
                </span>
                <span className="inline-flex items-center gap-1">
                  <ClockCircleOutlined />
                  {domain.last_updated_time ? getFormatTimeStamp(domain.last_updated_time) : '暂无更新'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default DomainSection