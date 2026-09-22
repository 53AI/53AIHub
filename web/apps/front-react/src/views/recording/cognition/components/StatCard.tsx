import { SvgIcon } from '@km/shared-components-react'

interface StatCardProps {
  label: string
  value: number | string
  tone: string
  iconName: string
  /** 传入则整卡可点击并展示 hover 反馈（如「待确认」打开全局待确认抽屉） */
  onClick?: () => void
}

export function StatCard({ label, value, tone, iconName, onClick }: StatCardProps) {
  const content = (
    <>
      <div className={`flex size-12 items-center justify-center rounded-xl ${tone}`}><SvgIcon name={iconName} size={24} /></div>
      <div>
        <div className="text-sm text-[#6B7280]">{label}</div>
        <div className="text-2xl font-semibold text-[#1D1E1F]">
          {value}
          <span className="ml-0.5 text-sm font-normal text-[#1D1E1F]">个</span>
        </div>
      </div>
    </>
  )

  if (!onClick) {
    return <div className="flex items-center gap-3 rounded-xl px-5 py-6 bg-white">{content}</div>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 rounded-xl bg-white px-5 py-6 text-left transition-shadow hover:shadow-[0_4px_16px_rgba(37,99,235,0.12)]"
    >
      {content}
    </button>
  )
}
