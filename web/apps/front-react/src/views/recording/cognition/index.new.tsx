import { useCallback, useEffect, useMemo, useState } from 'react'
import { RightOutlined } from '@ant-design/icons'
import recordingApi from '@/api/modules/recording'
import memoryApi from '@/api/modules/memory'
import { useUserStore, useIsAdmin } from '@/stores/modules/user'
import { useEnterpriseStore } from '@/stores/modules/enterprise'
import { useCognitionStore } from '@/stores/modules/cognition'
import { SvgIcon } from '@km/shared-components-react'
import { useRecordingFlutterPanel } from '@/stores/modules/recording-flutter-panel'
import type { RecordingCognitionDomain } from '@/api/modules/recording/types'
import { CORE_GROUPS } from './constants'
import { DomainSection } from './components/DomainSection'
import { PendingCognitionDrawer } from './components/PendingCognitionDrawer'
import { ProfileEditModal, type ProfileEditDraft } from './components/ProfileEditModal'
import { EnterpriseEditModal } from './components/EnterpriseEditModal'
import { CognitionContext } from './components/CognitionContext'
import { buildFlutterWebUrl } from '../components/flutter-panel/flutterUrl'
import { useFlutterPanelClosed } from '../components/flutter-panel/useFlutterPanelClosed'
import { useFlutterPanelMutation } from '../components/flutter-panel/useFlutterPanelMutation'
import { getPublicPath } from '@/utils/config'

import { SafeImage } from "@km/shared-components-react";import { getSimpleDateFormatString } from '@km/shared-utils'

// 老板画像卡片（个人信息 / 企业信息）共用的渐变背景
const PROFILE_CARD_BG =
  'radial-gradient(ellipse at 15% 0%, rgba(235, 243, 255, 0.3) 0%, rgba(255,255,255,0) 30%), radial-gradient(ellipse at 40% 2%, rgba(233, 241, 255, 0.35) 0%, rgba(255,255,255,0) 35%), radial-gradient(ellipse at 68% 1%, rgba(236, 244, 255, 0.3) 0%, rgba(255,255,255,0) 28%), radial-gradient(ellipse at 92% 3%, rgba(234, 242, 255, 0.28) 0%, rgba(255,255,255,0) 25%), #ffffff'

// 解析记忆内容：JSON 数组（MemoryItem[]）转纯文本，与 profile/memory 保持一致
const parseMemoryContent = (content?: string): string => {
  if (!content) return ''
  try {
    const items = JSON.parse(content)
    if (Array.isArray(items)) {
      return items.map((item: any) => item.fact || '').filter(Boolean).join('\n')
    }
  } catch {
    // 不是 JSON，直接返回原文
  }
  return content
}

function CognitionRegistryPanel() {
  const userStoreInfo = useUserStore((state) => state.info)
  const isAdmin = useIsAdmin()
  const enterpriseStore = useEnterpriseStore()

  // ---- 页面级共享状态 + 刷新协调 ----
  const [domainRegistry, setDomainRegistry] = useState<Awaited<ReturnType<typeof recordingApi.getCognitionDomains>>>([])
  const [coreTotals, setCoreTotals] = useState<Record<string, number>>({})
  const [latestCoreUpdate, setLatestCoreUpdate] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [mutationTick, setMutationTick] = useState(0)
  const [pendingTick, setPendingTick] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    // 三个统计数已收敛到共享 store（由侧边栏 10s 轮询填充），页面不再请求 overview，
    // 只需拉取领域列表与核心认知统计，同时获取最新核心认知更新时间。
    const [domainsResult, coreStatsResult, cognitionsResult] = await Promise.allSettled([
      recordingApi.getCognitionDomains(),
      recordingApi.getCoreStats(),
      recordingApi.getCognitions({ layer: 'core', limit: 1 }),
    ])
    if (domainsResult.status === 'fulfilled') setDomainRegistry(domainsResult.value || [])
    else setDomainRegistry([])
    if (coreStatsResult.status === 'fulfilled') {
      const stats = coreStatsResult.value
      setCoreTotals({
        principle: stats.principle,
        priority: stats.priority,
        criterion: stats.criterion,
        preference: stats.preference,
        boundary: stats.boundary,
        assumption: stats.assumption,
        trigger: stats.trigger,
      })
    } else {
      setCoreTotals({})
    }
    if (cognitionsResult.status === 'fulfilled') {
      const first = cognitionsResult.value?.items?.[0]
      const ts = first?.updated_time || first?.created_time
      if (ts) {
        setLatestCoreUpdate(getSimpleDateFormatString({ date: ts < 1e12 ? ts * 1000 : ts, format: 'YYYY-MM-DD' }))
      } else {
        setLatestCoreUpdate('2026-07-24')
      }
    } else {
      setLatestCoreUpdate('2026-07-24')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = useCallback(async () => {
    await load()
  }, [load])

  // 写操作成功后：主动重拉 overview 计数到 store（核心/领域/待确认即时反映），
  // 重拉页面数据，并递增 tick 让打开中的抽屉按需重拉
  const refreshAfterMutation = useCallback(async (pending = false) => {
    await useCognitionStore.getState().refresh()
    await refresh()
    setMutationTick((t) => t + 1)
    if (pending) setPendingTick((t) => t + 1)
  }, [refresh])

  const contextValue = useMemo(
    () => ({ loading, domainRegistry, coreTotals, refresh, refreshAfterMutation, mutationTick, pendingTick }),
    [loading, domainRegistry, coreTotals, refresh, refreshAfterMutation, mutationTick, pendingTick],
  )

  // ---- 个人信息（卡片展示 + 编辑弹窗初始值） ----
  const [profileInfo, setProfileInfo] = useState<Awaited<ReturnType<typeof memoryApi.user.get>> | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileInitial, setProfileInitial] = useState<ProfileEditDraft | null>(null)

  const loadProfile = useCallback(async () => {
    try {
      setProfileInfo(await memoryApi.user.get())
    } catch {
      // 个人信息加载失败：保持占位展示，不阻塞页面
    }
  }, [])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const openProfileEdit = () => {
    setProfileInitial({
      nickname: profileInfo?.nickname || '',
      department: profileInfo?.department || '',
      position: profileInfo?.position || '',
      style: profileInfo?.style || '',
      customMemory: parseMemoryContent(profileInfo?.custom_memory || ''),
    })
    setProfileOpen(true)
  }

  // ---- 弹窗 / 抽屉打开编排 ----
  const [pendingOpen, setPendingOpen] = useState(false)
  const [enterpriseOpen, setEnterpriseOpen] = useState(false)

  // 认知的「查看」「新建」全部改为界面最右侧 375px Flutter Web 面板（KM-Record）承载：
  // 点核心认知 / 领域卡片直接打开 Flutter 对应列表页，列表内的详情 / 新建在
  // Flutter 站内自行导航。面板内增 / 改 / 删实时上报，关闭面板时再刷新一次兜底。
  const openFlutterPanel = useRecordingFlutterPanel((s) => s.open)
  useFlutterPanelMutation((mutation) => {
    if (mutation.module === 'cognition') void refreshAfterMutation()
  })
  useFlutterPanelClosed(() => void refreshAfterMutation())

  // 查看核心认知：打开 Flutter Web 核心认知列表页（可带预选类型）
  const openCoreList = (group?: typeof CORE_GROUPS[number]) => {
    openFlutterPanel(
      buildFlutterWebUrl('/cognition/list', group ? { type: group.key } : undefined),
    )
  }

  // 查看领域认知：打开 Flutter Web 领域认知列表页（name 作 AppBar 标题）
  const openDomainList = (domain: RecordingCognitionDomain) => {
    openFlutterPanel(
      buildFlutterWebUrl(`/cognition/domain/${domain.id}`, { name: domain.name }),
    )
  }

  // 创建领域：打开 Flutter Web 领域新建页
  const openDomainCreate = () => {
    openFlutterPanel(buildFlutterWebUrl('/cognition/domain-edit'))
  }

  // 编辑领域：同样走 Flutter 面板编辑页（与新建一致）。领域名 / 描述 /
  // logo 随深链预填，面板内保存后收起面板并由 km-recording-mutation
  // 通知本页刷新（不再用 React 侧 DomainEditorModal，避免两套表单）。
  const openDomainEdit = (domain: RecordingCognitionDomain) => {
    openFlutterPanel(
      buildFlutterWebUrl('/cognition/domain-edit', {
        id: domain.id,
        name: domain.name,
        description: domain.description,
        logo: domain.logo,
      }),
    )
  }

  const coreCount = useCognitionStore((s) => s.coreCount)
  const pendingCount = useCognitionStore((s) => s.pendingCount)

  return (
    <CognitionContext.Provider value={contextValue}>
      <div className="min-h-0 min-w-0 flex-1 h-full overflow-auto bg-white text-[#1D1E1F] px-5 pb-12 pt-7 lg:px-8">
        <div className="w-full max-w-[1200px] mx-auto">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-medium  text-[#333332]">认知模型</h1>
              <p className="mt-1 text-sm text-[#888994]">基于你最近的会议、决策和经营变化，整理出的认知范围</p>
            </div>
          </div>

          {/* 待确认入口：有新萃取的认知时显示，点击打开 Flutter 待确认列表页
              （对齐核心/领域认知的 Flutter 面板模式） */}
          {pendingCount > 0 && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => openFlutterPanel(buildFlutterWebUrl('/cognition/pending'))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ')
                  openFlutterPanel(buildFlutterWebUrl('/cognition/pending'))
              }}
              className="group mt-4 h-10 flex cursor-pointer items-center justify-between rounded-lg bg-[#FFFAF5] px-5 transition-all hover:shadow-[0_4px_16px_rgba(250,140,22,0.08)]"
            >
              <div className="flex items-center gap-2.5">
                <SvgIcon name="pending-cognition" size={18} className="text-[#FA8C16]" />
                <span className="text-sm text-[#87421A]">
                  有 <span className="font-semibold text-[#D46B08]">{pendingCount}</span> 条新萃取的认知待确认
                </span>
              </div>
              <RightOutlined className="text-xs transition-transform group-hover:translate-x-0.5" />
            </div>
          )}

          {/* 核心认知卡片 */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => openCoreList()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') openCoreList()
            }}
            className="group relative mt-4 flex cursor-pointer items-center justify-between overflow-hidden rounded-2xl border border-[#E6EFFB] bg-gradient-to-r from-[#F0F6FF] via-[#F6FAFF] to-[#EDF4FE] px-7 py-6 shadow-[0_2px_12px_rgba(37,99,235,0.03)] transition-all hover:border-[#B9CDED] hover:shadow-[0_8px_24px_rgba(37,99,235,0.08)]"
          >
            {/* 左侧内容：3D水晶图标 + 标题与描述 + 条数 */}
            <div className="relative z-1 flex items-center gap-4">
              <SafeImage
                src={'/images/recording/core.png'}
                alt="核心认知"
                className="size-[68px] shrink-0 object-contain"
              />
              <div className="flex flex-col justify-center">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-lg font-semibold text-[#1D1E1F]">核心认知</h2>
                  <span className="text-sm font-normal text-[#888994]">老板长期坚持的基本经营准则</span>
                </div>
                <div className="mt-1 flex items-baseline">
                  <span className="text-[28px] font-bold leading-tight text-[#1D1E1F]">{coreCount}</span>
                  <span className="ml-1 text-sm font-normal text-[#1D1E1F]">条</span>
                </div>
              </div>
            </div>

            {/* 右上角：最近更新时间 */}
            <div className="relative z-1 self-start pt-1 text-xs text-[#888994]">
              最近更新: {latestCoreUpdate || '2026-07-24'}
            </div>
          </div>


          <DomainSection
            domains={domainRegistry}
            onOpenDrawer={openDomainList}
            onOpenEdit={openDomainEdit}
            onOpenCreate={openDomainCreate}
          />
        </div>

        <PendingCognitionDrawer
          open={pendingOpen}
          onClose={() => setPendingOpen(false)}
          placement="right"
        />

        <ProfileEditModal
          open={profileOpen}
          initial={profileInitial}
          onClose={() => setProfileOpen(false)}
          onSaved={() => void loadProfile()}
        />

        <EnterpriseEditModal
          open={enterpriseOpen}
          onClose={() => setEnterpriseOpen(false)}
        />

      </div>
    </CognitionContext.Provider>
  )
}

/** 认知模型独立入口；会议内的临时认知候选仍由洞察页负责展示。 */
export function RecordingCognitionModelView() {
  return <CognitionRegistryPanel />
}

export default RecordingCognitionModelView