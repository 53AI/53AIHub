import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Tag } from 'antd'
import { SvgIcon, SafeImage } from '@km/shared-components-react'
import Header from '@/components/Layout/Header'
import recordingApi from '@/api/modules/recording'
import memoryApi from '@/api/modules/memory'
import { DEFAULT_USER_AVATAR } from '@/constants/user'
import { useUserStore, useIsAdmin } from '@/stores/modules/user'
import { useEnterpriseStore } from '@/stores/modules/enterprise'
import { useCognitionStore } from '@/stores/modules/cognition'
import type {
  RecordingCognition,
  RecordingCognitionDomain,
  RecordingCognitionCanonicalType,
  RecordingCognitionLayer,
} from '@/api/modules/recording/types'
import { CORE_GROUPS } from './constants'
import type { DrawerScope } from './components/types'
import { StatCard } from './components/StatCard'
import { CoreCognitiveSection } from './components/CoreCognitiveSection'
import { DomainSection } from './components/DomainSection'
import { CognitionDrawer } from './components/CognitionDrawer'
import { PendingCognitionDrawer } from './components/PendingCognitionDrawer'
import { CognitionEditorModal, type CognitionEditorInit } from './components/CognitionEditorModal'
import { CognitionDetailModal } from './components/CognitionDetailModal'
import { DomainEditorModal } from './components/DomainEditorModal'
import { ProfileEditModal, type ProfileEditDraft } from './components/ProfileEditModal'
import { EnterpriseEditModal } from './components/EnterpriseEditModal'
import { CognitionContext } from './components/CognitionContext'
import { getPublicPath } from '@/utils'

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
  const [loading, setLoading] = useState(true)
  const [mutationTick, setMutationTick] = useState(0)
  const [pendingTick, setPendingTick] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    // 三个统计数已收敛到共享 store（由侧边栏 10s 轮询填充），页面不再请求 overview，
    // 只需拉取领域列表与核心认知统计。
    const [domainsResult, coreStatsResult] = await Promise.allSettled([
      recordingApi.getCognitionDomains(),
      recordingApi.getCoreStats(),
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
  const [drawerScope, setDrawerScope] = useState<DrawerScope | null>(null)
  const [pendingOpen, setPendingOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorInitial, setEditorInitial] = useState<CognitionEditorInit | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailTarget, setDetailTarget] = useState<RecordingCognition | null>(null)
  const [enterpriseOpen, setEnterpriseOpen] = useState(false)
  const [domainOpen, setDomainOpen] = useState(false)
  const [domainInitial, setDomainInitial] = useState<RecordingCognitionDomain | null>(null)

  const openCoreDrawer = (group: typeof CORE_GROUPS[number]) => {
    setDrawerScope({ kind: 'core', key: group.key as RecordingCognitionCanonicalType, label: group.label, hint: group.hint })
  }

  const openDomainDrawer = (domain: RecordingCognitionDomain) => {
    setDrawerScope({ kind: 'situational', code: domain.code, id: domain.id, label: domain.name, hint: domain.description || '' })
  }

  const beginCreateInDrawer = (scope: DrawerScope) => {
    setEditorInitial({
      title: '',
      statement: '',
      cognitionType: scope.kind === 'core' ? scope.key : 'principle',
      layer: scope.kind === 'core' ? 'core' : 'situational',
      domainId: scope.kind === 'situational' ? scope.id : '',
    })
    setEditorOpen(true)
  }

  // 统一从条目（详情或列表项）装配编辑弹窗初始值
  const buildEditorInit = (item: {
    id: string | number
    title: string
    statement: string
    cognition_type?: RecordingCognitionCanonicalType | string
    layer?: RecordingCognitionLayer | string
    domain_id?: string
  }): CognitionEditorInit => ({
    editingId: item.id,
    title: item.title,
    statement: item.statement,
    cognitionType: (item.cognition_type || '') as RecordingCognitionCanonicalType | '',
    layer: (item.layer || 'core') as RecordingCognitionLayer,
    domainId: item.domain_id || '',
  })

  // 统一从条目（详情或列表项）打开编辑器；详情入口传 closeDetail 以先关详情弹窗
  const openEditor = (item: Parameters<typeof buildEditorInit>[0], closeDetail = false) => {
    setEditorInitial(buildEditorInit(item))
    setEditorOpen(true)
    if (closeDetail) setDetailOpen(false)
  }

  const openEditFromDetail = (detail: Awaited<ReturnType<typeof recordingApi.getCognition>>) => openEditor(detail, true)

  const openDetail = (item: RecordingCognition) => {
    setDetailTarget(item)
    setDetailOpen(true)
  }

  const openDomainCreate = () => {
    setDomainInitial(null)
    setDomainOpen(true)
  }

  const openDomainEdit = (domain: RecordingCognitionDomain) => {
    setDomainInitial(domain)
    setDomainOpen(true)
  }

  const coreCount = useCognitionStore((s) => s.coreCount)
  const situationalCount = useCognitionStore((s) => s.situationalCount)
  const pendingCount = useCognitionStore((s) => s.pendingCount)

  return (
    <CognitionContext.Provider value={contextValue}>
      <div className="min-h-0 min-w-0 flex-1 h-full overflow-auto bg-[#F6F8FC] text-[#1D1E1F]">
        <Header title="认知模型" border={false} />
        <div className="w-full px-5 pb-12 pt-7 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[22px] font-medium  text-[#1D1E1F]">认知模型</h1>
              <p className="mt-1 text-sm text-[#6B7280]">这是我目前对你的经营判断方式的理解。认知模型决定 “你通常怎么判断”</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-1 xl:grid-cols-3">
            <StatCard label="核心认知" value={coreCount} tone="bg-[#FFF8EB] text-[#F0A105]" iconName="core-cognition" />
            <StatCard label="领域认知" value={situationalCount} tone="bg-[#FFF0F0] text-[#FA5151]" iconName="domain-cognition" />
            <StatCard label="待确认" value={pendingCount} tone="bg-[#F0F4FF] text-[#2563EB]" iconName="pending-cognition" onClick={() => setPendingOpen(true)} />
          </div>

          <section className="mt-8">
            <div className="mb-3">
              <h2 className="text-lg font-medium text-[#1D1E1F]">老板画像</h2>
            </div>
            <section className="grid gap-3 xl:grid-cols-2">
              <div className="relative overflow-hidden rounded-xl border border-[#E4EAF3] bg-white p-4 shadow-[0_7px_24px_rgba(35,64,108,0.04)] lg:p-5 group" style={{ background: PROFILE_CARD_BG }}>
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-medium text-[#1D1E1F]">个人信息</h2>
                  <Button className="gap-1 invisible group-hover:visible hover:!text-[#1677ff] hover:!bg-[#e6f4ff]" size="small" color="default" variant='filled' onClick={openProfileEdit}>
                    <SvgIcon name="edit" size={12} />
                    编辑
                  </Button>
                </div>
                <div className="mt-6 flex items-center gap-3">
                  <SafeImage
                    className="size-12 flex-none rounded-full object-cover"
                    src={(userStoreInfo)?.avatar || ''}
                    fallback={DEFAULT_USER_AVATAR}
                    round={24}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-medium text-[#1D1E1F]">
                      {profileInfo?.nickname || userStoreInfo?.nickname || '尚未设置昵称'}
                    </div>
                    {(profileInfo?.position || profileInfo?.department) && (
                      <div className="mt-1 flex gap-1.5">
                        {profileInfo?.position && <Tag color="#EE7702" variant='filled'>{profileInfo.position}</Tag>}
                        {profileInfo?.department && <Tag color="#0082F0" variant='filled'>{profileInfo.department}</Tag>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex mt-6">
                  <div className="flex-1">
                    <div className="text-sm text-[#9CA3AF]">期望风格</div>
                    <div className="text-sm text-[#1D1E1F] mt-1 line-clamp-1">{profileInfo?.style || '未设置'}</div>
                  </div>
                </div>
                <div className="flex mt-6">
                  <div className="flex-1">
                    <div className="text-sm text-[#9CA3AF]">个性要求</div>
                    <div className="text-sm text-[#1D1E1F] mt-1 line-clamp-2">{parseMemoryContent(profileInfo?.custom_memory || '') || '未设置'}</div>
                  </div>
                </div>
                <img className='absolute right-0 -bottom-20' src={getPublicPath('/images/recording/sc.png')}></img>
              </div>
              <div className="relative overflow-hidden rounded-xl border border-[#E4EAF3] bg-white p-4 shadow-[0_7px_24px_rgba(35,64,108,0.04)] lg:p-5 group" style={{ background: PROFILE_CARD_BG }}>
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-medium text-[#1D1E1F]">企业信息</h2>
                  {isAdmin && (
                    <Button className="gap-1 invisible group-hover:visible hover:!text-[#1677ff] hover:!bg-[#e6f4ff]" size="small" color="default" variant='filled' onClick={() => setEnterpriseOpen(true)}>
                      <SvgIcon name="edit" size={12} />
                      编辑
                    </Button>
                  )}
                </div>
                <div className="mt-6 flex items-center gap-3">
                  <SvgIcon className="size-12 flex-none" name="enterprise" size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-medium text-[#1D1E1F]">
                      {enterpriseStore.full_name || ''}
                    </div>
                    <div className="mt-1 flex gap-1.5">
                      {(enterpriseStore.display_name) && (
                        <Tag color="#0082F0" variant='filled'>{enterpriseStore.display_name}</Tag>
                      )}
                      {(enterpriseStore.industry) && (
                        <Tag color="#EE7702" variant='filled'>{enterpriseStore.industry}</Tag>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex mt-6">
                  <div className="flex-1">
                    <div className="text-sm text-[#9CA3AF]">企业介绍</div>
                    <div className="text-sm text-[#1D1E1F] mt-1 line-clamp-5">{enterpriseStore.description || '暂无企业简介'}</div>
                  </div>
                </div>
                <img className='absolute right-0 -bottom-20' src={getPublicPath('/images/recording/sc.png')}></img>
              </div>
            </section>
          </section>

          <CoreCognitiveSection
            loading={loading}
            coreTotals={coreTotals}
            onOpenCoreDrawer={openCoreDrawer}
          />

          <DomainSection
            domains={domainRegistry}
            onOpenDrawer={openDomainDrawer}
            onOpenEdit={openDomainEdit}
            onOpenCreate={openDomainCreate}
          />
        </div>

        <CognitionDrawer
          open={Boolean(drawerScope)}
          scope={drawerScope}
          onClose={() => setDrawerScope(null)}
          onOpenDetail={openDetail}
          onAdd={beginCreateInDrawer}
        />

        <PendingCognitionDrawer
          open={pendingOpen}
          onClose={() => setPendingOpen(false)}
          placement="right"
        />

        <CognitionEditorModal
          open={editorOpen}
          initial={editorInitial}
          onClose={() => setEditorOpen(false)}
          onSaved={() => void refreshAfterMutation()}
        />

        <CognitionDetailModal
          open={detailOpen}
          target={detailTarget}
          scopeLabel={drawerScope?.label}
          onClose={() => setDetailOpen(false)}
          onEdit={openEditFromDetail}
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

        <DomainEditorModal
          open={domainOpen}
          initial={domainInitial}
          onClose={() => setDomainOpen(false)}
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