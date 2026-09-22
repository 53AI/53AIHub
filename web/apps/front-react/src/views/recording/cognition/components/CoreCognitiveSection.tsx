import { Spin } from 'antd'
import { CORE_GROUPS } from '../constants'
import { RegistryIcon } from './RegistryIcon'

interface CoreCognitiveSectionProps {
  loading: boolean
  coreTotals: Record<string, number>
  onOpenCoreDrawer: (group: (typeof CORE_GROUPS)[number]) => void
}

export function CoreCognitiveSection({ loading, coreTotals, onOpenCoreDrawer }: CoreCognitiveSectionProps) {
  return (
    <section className="mt-8">
      <div className="mb-3">
        <h2 className="text-lg font-medium text-[#1D1E1F]">核心认知</h2>
        <p className="mt-1 text-sm text-[#9CA3AF]">二号总裁根基于你最近的会议、决策和经营变化，整理出的领域认知</p>
      </div>
      {loading ? <div className="flex h-40 items-center justify-center"><Spin size="small" /></div> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {CORE_GROUPS.map((group) => {
            const total = coreTotals[group.key] ?? 0
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => onOpenCoreDrawer(group)}
                className="group min-h-[94px] rounded-xl border border-[#E1E6ED] bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[#B9CDED] hover:shadow-[0_8px_20px_rgba(37,67,112,0.08)]"
              >
                <div className="flex items-center gap-2.5">
                  <RegistryIcon name={group.key} iconBg={group.iconBg} />
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-medium text-[#1D1E1F]">{group.label}</h3>
                    <span className="rounded-full bg-[#F2F4F7] px-2 py-0.5 text-[11px] font-medium leading-4 text-[#000000]">{total}</span>
                  </div>
                </div>
                <p className="mt-1 line-clamp-1 text-sm text-[#9CA3AF]">{group.hint}</p>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default CoreCognitiveSection