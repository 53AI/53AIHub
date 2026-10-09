import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Navigate, Outlet, useMatch, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Checkbox, Form, Input, Modal, Dropdown, Popover, Tooltip, message } from 'antd'
import { SearchOutlined, RedoOutlined, LoadingOutlined } from "@ant-design/icons"
import type { MenuProps } from 'antd'
import { useEnv } from '@/hooks/useEnv'
import { usePoll } from '@/hooks/usePoll'
import { checkVersion } from '@/utils/version'
import { VERSION_MODULE } from '@/constants/enterprise'
import { useRecordingStore } from '@/stores/modules/recording'
import { useCognitionStore } from '@/stores/modules/cognition'
import recordingApi from '@/api/modules/recording'
import { buildUrl } from '@/utils/router'
import { t } from '@/locales'
import { useMySpaceContext } from '@/views/mine/hooks/useMySpaceContext'
import { useAudioImport } from '@/views/mine/hooks/useAudioImport'
import { AUDIO_ACCEPT } from '@/views/mine/constants'
import type {
  RecordingDeviceConfig,
  RecordingDeviceStatusResponse,
  SyncStatusResponse,
} from '@/api/modules/recording/types'
import { groupApi } from '@/api/modules/group'
import type { Group } from '@/api/modules/group'
import { GROUP_TYPE } from '@/constants/group'
import {
  useRecordingList,
  type RecordingFileItemUI,
  type RecordingFilter,
} from './hooks/useRecordingList'
import { RecordingFileList } from './components/list/RecordingFileList'
import { GroupDialog, type GroupDialogRef } from '@/components/GroupDialog'
import { ResponsiveSidebar } from '@/components/Layout/ResponsiveSidebar'
import { SvgIcon } from "@km/shared-components-react"
import { useLibraryStore } from '@/stores/modules/library'
import agentsApi from '@/api/modules/agents'
import { AGENT_USAGES } from '@/constants/agent'
import { BRAND_OPTIONS, SONICNOTE_DEVICE_TYPE, type DeviceType } from './constants/brandOptions'
import { MAX_AUDIO_IMPORT_SIZE } from './constants/recordingLimits'
import { ConnectDeviceModal } from './components/brand/ConnectDeviceModal'
import { DeviceListPopover } from './components/brand/DeviceListPopover'

// 从分组数据构建分类标签（前置"全部"选项）
const groupsToTags = (groups: Group[]): { key: string; label: string }[] => [
  { key: '0', label: '全部' },
  ...groups
    .filter((g) => g.group_name.trim())
    .map((g) => ({ key: String(g.group_id), label: g.group_name })),
]

/**
 * BrandPicker 已抽取到 components/brand/BrandPicker.tsx
 * 单一来源：constants/brandOptions.ts
 */

/**
 * RecordingView 通过 <Outlet context> 下发给右栏子路由的能力。
 * 预览页的收藏/重命名/移动/删除必须直接作用于左栏那一份列表状态，
 * 否则两边会各自持有一份数据而不同步。
 */
export type RecordingOutletContext = {
  categoryTags: { key: string; label: string }[]
  refresh: () => void
  updateFileName: (id: string, name: string) => void
  updateFileDescription: (id: string, description: string) => void
  findListItem: (id: string) => RecordingFileItemUI | null
  toggleFavorite: (id: string, isFavorite: boolean) => Promise<void> | void
  removeFile: (item: RecordingFileItemUI) => Promise<void> | void
  moveTo: (item: RecordingFileItemUI, groupId: number) => Promise<void>
  openRenameModal: (item: RecordingFileItemUI) => void
}

export function RecordingView() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  // 旧 URL /recording?preview=xxx 兼容重定向：
  // 把它转成 /recording/preview/:fileId，由专用路由直接渲染预览（无首页闪烁）。
  // 老链接、邮件分享、收藏夹里残留的 query 都能继续 work，但不会再经历"先看到首页"。
  const legacyPreviewId = searchParams.get('preview')
  if (legacyPreviewId) {
    return <Navigate to={`/recording/preview/${legacyPreviewId}`} replace />
  }
  const { isOpLocalEnv, isPrivatePremEnv } = useEnv()
  // 当前预览的文件 id 从 URL 派生（子路由 /recording/preview/:fileId），
  // 不再用组件内 state——列表高亮与右栏内容由同一个 URL 决定，天然一致。
  const previewMatch = useMatch('/recording/preview/:fileId')
  const selectedFileId = previewMatch?.params.fileId ?? null
  const cognitionMatch = useMatch('/recording/cognition')
  const hasRecording = checkVersion(VERSION_MODULE.RECORDING)
  const recordingStatus = useRecordingStore((s) => s.status)
  const isTransitioning = useRecordingStore((s) => s.isTransitioning)
  const prevRecordingStatusRef = useRef(recordingStatus)

  // 搜索：keywordInput 即时更新，keyword 防抖后驱动取数
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [category] = useState<RecordingFilter>('all')
  const [enableSystemAudio, setEnableSystemAudio] = useState(true)

  // getDisplayMedia is unsupported on iOS Safari / Android Chrome and on desktop
  // browsers that predate the Screen Capture API. Hide the toggle when missing.
  const isSystemAudioSupported = useMemo(() => {
    if (typeof navigator === 'undefined') return false
    return typeof navigator.mediaDevices?.getDisplayMedia === 'function'
  }, [])
  const recordingConfig = useRecordingStore((s) => s.recordingConfig)
  // 分类标签（从分组数据加载）
  const [categoryTags, setCategoryTags] = useState<{ key: string; label: string }[]>(
    () => groupsToTags([]),
  )
  const [activeCategoryTag, setActiveCategoryTag] = useState<string>('0')
  const [groupsLoaded, setGroupsLoaded] = useState(false)

  // 排序状态
  const [sortOrder, setSortOrder] = useState<'updated_time' | 'created_time'>('updated_time')
  const groupDialogRef = useRef<GroupDialogRef>(null)
  // 排队中的文件数
  const [queuedCount, setQueuedCount] = useState(0)

  // 控制文档助手入口（AssistantBtn）显示：
  // 仅当 后台开关 recording_agent_enabled = true 且 usage=5 至少有一个启用时展示。
  // 开关关闭时直接 false，不发 agents 请求。
  useEffect(() => {
    const recordingAgentEnabled = !!recordingConfig?.recording_agent_enabled
    if (!recordingAgentEnabled) {
      useLibraryStore.getState().setAssistantInstall(false)
      return
    }
    const loadAssistantInstall = async () => {
      try {
        const res = await agentsApi.list({
          agent_usages: String(AGENT_USAGES.KM_RECORDING_CHAT),
        })
        const hasAgentEnabled = res.agents.some((item: any) => item.enable)
        useLibraryStore
          .getState()
          .setAssistantInstall(hasAgentEnabled)
      } catch {
        // ignore
      }
    }
    loadAssistantInstall()
  }, [recordingConfig?.recording_agent_enabled])

  // rename 弹窗
  const [renameModalVisible, setRenameModalVisible] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renamingItem, setRenamingItem] = useState<RecordingFileItemUI | null>(
    null,
  )

  // 接入弹窗
  const [connectModalVisible, setConnectModalVisible] = useState(false)
  const [connectForm] = Form.useForm<{
    brand: RecordingDeviceConfig['device_type']
    apiKey: string
  }>()
  const [connectLoading, setConnectLoading] = useState(false)

  // 当前用户的全部设备配置（多 type + 多 key）。
  // 用于决定左栏显示"接入"还是"同步"、浮层渲染、激活切换、自动同步等所有设备流。
  const [devices, setDevices] = useState<RecordingDeviceConfig[]>([])
  // 当前激活设备（后端 is_active 标记）
  const activeDevice = useMemo(
    () => devices.find((d) => d.is_active) ?? null,
    [devices],
  )
  // 是否有任何已配置 Key 的设备（控制 popover 入口可点击）
  const hasDeviceData = devices.some((d) => !!d.api_key)

  // ---- 同步任务状态 ----
  // 后端契约是「每用户单 job」（GET /sync-status 无参、POST /sync 有防重入 code=4），
  // 所以前端也只追踪一个 job：
  // - syncJobRef 是唯一真相，'pending' = 已发起但还没拿到 job_id（用来挡住连点）。
  //   必须用 ref：轮询回调与 fireSync 入口都要"同步"读取，setState 异步会读到旧值。
  // - syncing 只用于渲染，永远经 setSyncJob 一起改，杜绝两份状态漂移。
  const syncJobRef = useRef<'pending' | string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const setSyncJob = useCallback((job: 'pending' | string | null) => {
    syncJobRef.current = job
    setSyncing(job !== null)
  }, [])
  // 本次挂载是否已自动同步过（"进入页面自动同步一次"，刷新页面重新计）
  const autoSyncedRef = useRef(false)
  // refresh 引用：轮询回调要调最新的 refresh（它依赖 keyword/sortBy/groupId 会重建），
  // 在下方 useRecordingList 之后由 effect 绑定 current
  const refreshRef = useRef<(() => void) | null>(null)

  // 设备可用性探测结果，按 device_type 存放。
  // 必须是 map：浮层里每个 type 一个状态点，用单个对象会被并发探测中最后返回的那次
  // 覆盖，其余 type 永远停在灰点。探测失败时保留该 type 旧值，
  // 避免把"已知可用"的设备瞬间显示成不可用。
  const [deviceStatusMap, setDeviceStatusMap] = useState<
    Partial<Record<DeviceType, RecordingDeviceStatusResponse>>
  >({})
  // 探测序号按 type 分桶：同 type 的慢请求不覆盖快请求，不同 type 互不干扰
  const probeSeqRef = useRef<Partial<Record<DeviceType, number>>>({})
  const activeDeviceStatus = activeDevice
    ? deviceStatusMap[activeDevice.device_type as DeviceType] ?? null
    : null

  // 「我的设备」浮层开关
  const [deviceListOpen, setDeviceListOpen] = useState(false)
  // 当前正在编辑的设备（null = 新增模式）
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null)
  const editingDevice = useMemo(
    () => (editingDeviceId ? devices.find((d) => d.id === editingDeviceId) ?? null : null),
    [editingDeviceId, devices],
  )
  // 切换激活设备（后端 setActiveDevice 幂等；reloadDevices 兜底，无需前端防双击）

  // 设备列表兜底：没有任何 is_active（后端没写入 / 被运维清空）时激活第一个 enabled 设备。
  // 返回「应当写入 state 的最终列表」，调用方不必自己拼；列表为空 / 全 disabled 时静默退出。
  // 失败静默：这不是用户主动行为，不该弹错干扰 UX。
  const ensureActiveDevice = useCallback(async (list: RecordingDeviceConfig[]) => {
    if (list.some((d) => d.is_active)) return list
    const first = list.find((d) => d.enabled)
    if (!first?.id) return list
    try {
      await recordingApi.setActiveDevice(first.id)
      return await recordingApi.getDevices()
    } catch {
      return list
    }
  }, [])

  // 拉设备列表 → 兜底激活 → 写入 state，返回最终列表。
  // 接入/编辑/删除后共用；fallback 用于拉取失败时至少让 UI 反映出本次操作结果。
  const reloadDevices = useCallback(
    async (fallback: RecordingDeviceConfig[]) => {
      let list = fallback
      try {
        list = await recordingApi.getDevices()
      } catch {
        // 拉取失败：退回调用方给的本地列表
      }
      list = await ensureActiveDevice(list)
      setDevices(list)
      return list
    },
    [ensureActiveDevice],
  )

  // 实时探测设备可用性（不缓存）。触发时机：进入页面（仅 active）、绑定/换 Key 后、
  // 手动同步前、打开浮层（所有已配置 Key 的 type）。
  // 业务上的"不可用"由后端以 available=false + reason 返回（HTTP 200），
  // 走 catch 的只有真正的网络/服务异常。
  // 返回本次探测的最新可用性结果（null = 已被更新的探测覆盖，或网络失败）。
  // 自动同步必须等结果才能决定要不要 fireSync，所以返回比 void 写 state 重要。
  const probeDevice = useCallback(async (deviceType: DeviceType): Promise<RecordingDeviceStatusResponse | null> => {
    const seq = (probeSeqRef.current[deviceType] ?? 0) + 1
    probeSeqRef.current[deviceType] = seq
    try {
      const status = await recordingApi.getDeviceStatus(deviceType)
      // 仅当本次仍是该 type 最新一次探测时写回
      if (probeSeqRef.current[deviceType] !== seq) return null
      setDeviceStatusMap((prev) => ({ ...prev, [deviceType]: status }))
      return status
    } catch {
      // 网络/服务不可达：返回 null 表示「未知」，调用方应保守地跳过 fireSync
      return null
    }
  }, [])

  // 仅允许在已有接入数据时打开 popover（关闭永远允许）。
  // 打开时探测所有已配置 Key 的 type，刷新各自状态点。
  const handleDeviceListOpenChange = useCallback((open: boolean) => {
    if (open) {
      if (!hasDeviceData) return
      const types = new Set(
        devices.filter((d) => !!d.api_key).map((d) => d.device_type as DeviceType),
      )
      for (const type of types) void probeDevice(type)
    }
    setDeviceListOpen(open)
  }, [hasDeviceData, devices, probeDevice])

  const { ensureLibraryId } = useMySpaceContext()
  const {
    fileList,
    loading,
    hasMore,
    loadMore,
    refresh,
    toggleFavorite,
    rename,
    remove,
    updateFileGroup,
    updateFileName,
    updateFileDescription,
  } = useRecordingList({ keyword, category, sortBy: sortOrder, groupId: activeCategoryTag && activeCategoryTag !== '0' ? Number(activeCategoryTag) : undefined, ready: groupsLoaded })
  // refresh 定义后绑定到 ref。必须在 effect 里赋值：
  // render 阶段写 ref 属于副作用，并发/StrictMode 下不安全。
  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  const audioImport = useAudioImport({
    ensureLibraryId,
    currentPath: '/',
    onSuccess: () => {
      refresh()
    },
    groupId: activeCategoryTag && activeCategoryTag !== '0' ? Number(activeCategoryTag) : undefined,
    maxSize: MAX_AUDIO_IMPORT_SIZE,
  })

  const hasActiveRecording = recordingStatus !== 'idle'
  const showRecordingButton =
    !isOpLocalEnv &&
    !isPrivatePremEnv &&
    hasRecording &&
    !!recordingConfig?.enabled

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => setKeyword(keywordInput), 300)
    return () => clearTimeout(timer)
  }, [keywordInput])

  // 加载分组标签：避免初始化与 GroupDialog 内部 refresh 同时触发导致的重复请求
  const loadingGroupsRef = useRef(false)
  const loadGroups = useCallback(async () => {
    if (loadingGroupsRef.current) return
    loadingGroupsRef.current = true
    try {
      const list = await groupApi.user.list({ params: { group_type: GROUP_TYPE.RECORDING_FILE } })
      const groups = [...list]
      const tags = groupsToTags(groups)
      setCategoryTags(tags)
    } catch {
      // ignore
    } finally {
      loadingGroupsRef.current = false
      setGroupsLoaded(true)
    }
  }, [])

  useEffect(() => {
    loadGroups()
  }, [loadGroups])

  // 请求排队任务数
  // 5s 轮询一次；队列空（queued_count=0）时主动 stop，避免空闲时无意义请求。
  // 组件卸载由 usePoll 自动 stop。
  const {
    start: startQueueCountPoll,
    stop: stopQueueCountPoll,
  } = usePoll(async () => {
    try {
      const res = await recordingApi.getMyQueuedCount()
      setQueuedCount(res.queued_count)
      if (res.queued_count === 0) {
        // 队列清空 → 停掉轮询；下次新增任务时由 fileList.length 监听器再起一次
        stopQueueCountPoll()
      }
    } catch {
      // 单次失败不打断，下一轮继续
    }
  }, 5000)

  // 进入列表页先取一次排队任务数，并启动轮询
  useEffect(() => {
    startQueueCountPoll()
  }, [startQueueCountPoll])

  // 文件列表变长时（导入/录音后）重启轮询；
  // startQueueCountPoll 会立即触发一次 fn（拿到最新 count 立即刷新徽章），
  // 并在 count 回到 0 时自动 stop——后续空闲无轮询。
  const prevFileListLengthRef = useRef(0)
  useEffect(() => {
    if (fileList.length > prevFileListLengthRef.current) {
      startQueueCountPoll()
    }
    prevFileListLengthRef.current = fileList.length
  }, [fileList.length, startQueueCountPoll])

  // 认知待确认数：徽标读共享 store（认知页写操作后即时更新）。
  // 这里再低频轮询 store.refresh() 兜底，覆盖外部会话/设备导致的变动；
  // 接口请求已收敛到 store，不在此直接调用 getCognitionOverview。轮询常开不停，单次失败由 store 内部吞掉。
  const cognitionPendingCount = useCognitionStore((s) => s.pendingCount)
  const { start: startCognitionPendingPoll } = usePoll(() => useCognitionStore.getState().refresh(), 10000)
  useEffect(() => {
    startCognitionPendingPoll()
  }, [startCognitionPendingPoll])

  // 录音结束（status 转 idle）刷新列表并提示
  useEffect(() => {
    if (prevRecordingStatusRef.current !== 'idle' && recordingStatus === 'idle') {
      message.success('录音已上传，录音转写与洞察生成需要一些时间...')
      refresh()
    }
    prevRecordingStatusRef.current = recordingStatus
  }, [recordingStatus, refresh])

  // 点列表项：跳转到 /recording/preview/:fileId 专用路由。
  // 列表与预览已分离为两条路由，不再用 inline selectedFile state 在同一页切换。
  const handleSelect = (item: RecordingFileItemUI) => {
    navigate(`/recording/preview/${item.id}`)
  }

  // 旧的 ?preview= 兼容逻辑已由顶部的 <Navigate> 处理，
  // 直接访问 /recording/preview/:fileId 走专用路由（无首页闪烁）。
  // 这里不再需要 URL preview 加载 effect 与 clearPreviewParam。

  // 左栏"经营记忆"入口：回到 /recording 索引路由，右栏渲染经营记忆页
  const goToHome = () => {
    navigate('/recording')
  }

  const goToCognition = () => {
    navigate('/recording/cognition')
  }

  // 列表更多菜单命令。new-tab 打开预览专用路由的直链
  const handleListCommand = async (item: RecordingFileItemUI, cmd: string) => {
    if (cmd === 'new-tab') {
      window.open(buildUrl(`/recording/preview/${item.id}`), '_blank')
    } else if (cmd === 'favorite') {
      await toggleFavorite(item.id, item.isFavorite)
    } else if (cmd === 'rename') {
      setRenamingItem(item)
      setRenameValue(item.name)
      setRenameModalVisible(true)
    } else if (cmd.startsWith('move-to:')) {
      const groupId = Number(cmd.slice('move-to:'.length))
      await handleMoveTo(item, groupId)
    } else if (cmd === 'delete') {
      Modal.confirm({
        title: t('common.tip'),
        content: t('status.file_del'),
        okText: t('action.confirm'),
        cancelText: t('action.cancel'),
        onOk: async () => {
          await remove(item)
          // 删的正是当前预览文件时退回录音首页，避免右栏残留在已删文件上
          if (item.id === selectedFileId) {
            navigate('/recording', { replace: true })
          }
        },
      })
    }
  }

  // 移动文件到分组：PUT /api/recordings/files/{file_id}/group
  // group_id = 0 表示移出分组（未分组）；仅在全部分类下保留列表，其他场景刷新以脱离过滤范围
  const handleMoveTo = async (item: RecordingFileItemUI, groupId: number) => {
    const target = categoryTags.find((tag) => tag.key === String(groupId))
    const targetLabel = target?.label ?? ''
    const previousGroupId = item.groupId
    // 乐观更新本地 groupId，新分组不匹配当前过滤条件时由 refresh 处理
    updateFileGroup(item.id, groupId)
    try {
      await recordingApi.moveFileToGroup(item.id, { group_id: groupId })
      message.success(t('mine.moved_to', { name: targetLabel }))
      // 仅当当前过滤的是具体分组，且文件新分组与之不匹配时才刷新：
      // - 全部分类（activeCategoryTag === '0'）下，仅更新分类 ID，保留文件在列表中
      // - 具体分组下，新分组与当前一致则保留；不一致则刷新以脱离过滤范围
      if (activeCategoryTag && activeCategoryTag !== '0' && Number(activeCategoryTag) !== groupId) {
        refresh()
      }
    } catch (e: any) {
      // 失败回滚本地状态
      updateFileGroup(item.id, previousGroupId)
      const msg = e?.response?.data?.message || e?.message || ''
      message.error(msg || t('mine.move_failed'))
    }
  }

  // rename 弹窗确认
  const handleRenameConfirm = async () => {
    if (!renamingItem || !renameValue.trim()) return
    const item = renamingItem
    try {
      await rename(item, renameValue.trim())
      setRenameModalVisible(false)
      setRenamingItem(null)
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || ''
      const displayMsg = msg.includes('目标路径已存在') ? '已有相同文件名' : (msg || '重命名失败')
      message.error(displayMsg)
    }
  }

  const handleStartRecording = () => {
    if (hasActiveRecording) {
      message.warning('正在运行录音，结束当前录音后可开启新的录音...')
      return
    }
    const groupId = activeCategoryTag && activeCategoryTag !== '0' ? Number(activeCategoryTag) : undefined
    useRecordingStore.getState().start(true, groupId, enableSystemAudio)
  }

  // 传给右栏子路由的上下文：预览页需要反向驱动左栏列表
  // （重命名/收藏/移动/删除都要让列表立刻反映，不能各自持一份状态）。
  const outletContext: RecordingOutletContext = {
    categoryTags,
    refresh,
    updateFileName,
    updateFileDescription,
    findListItem: (id: string) => fileList.find((it) => it.id === id) ?? null,
    toggleFavorite,
    removeFile: remove,
    moveTo: handleMoveTo,
    openRenameModal: (item) => {
      setRenamingItem(item)
      setRenameValue(item.name)
      setRenameModalVisible(true)
    },
  }

  // 排序菜单
  const sortMenuItems: MenuProps['items'] = [
    {
      key: 'updated_time',
      label: t('agent.sort_by_updated_time'),
    },
    {
      key: 'created_time',
      label: t('agent.sort_by_created_time'),
    },
  ]

  // ============ SonicNote 设备 & 同步 ============

  // 同步任务终态复位：所有终止路径只走这一处，杜绝「写 ref 不写 state / 反之」的漂移
  const finishSync = useCallback((result: 'completed' | 'failed' | 'interrupted', status?: SyncStatusResponse) => {
    setSyncJob(null)
    stopSyncPollRef.current?.()
    if (result === 'completed' && status) {
      message.success(
        `同步完成，共发现 ${status.discovered} 条，新增 ${status.imported} 条，失败 ${status.failed} 条`,
      )
      refreshRef.current?.()
    } else if (result === 'failed') {
      message.error(status?.error_message || '同步失败')
    } else {
      message.warning('上次同步被中断，请点击同步重新尝试')
    }
  }, [setSyncJob])

  // 同步状态轮询：每 2s 拿一次，job 不匹配（被新任务覆盖 / 后端重启清空）就放弃本轮追踪。
  // 终态走 finishSync 统一复位；非终态或单次失败继续轮询。
  // 必须用 ref 拿到最新的 stopSyncPoll，避免 useCallback 闭包过期。
  const stopSyncPollRef = useRef<(() => void) | null>(null)
  const syncPollTick = useCallback(async () => {
    const jobId = syncJobRef.current
    if (typeof jobId !== 'string') return
    let status: SyncStatusResponse | null
    try {
      status = await recordingApi.getSyncStatus()
    } catch {
      return  // 单次失败不打断，下一轮继续
    }
    if (!status || status.job_id !== jobId) return
    if (status.status === 'completed') {
      finishSync('completed', status)
    } else if (status.status === 'failed') {
      finishSync('failed', status)
    } else if (status.status === 'interrupted') {
      finishSync('interrupted', status)
    }
  }, [finishSync])

  const { start: startSyncPoll, stop: stopSyncPoll } = usePoll(syncPollTick, 2000)
  useEffect(() => {
    stopSyncPollRef.current = stopSyncPoll
  }, [stopSyncPoll])

  // 触发同步：调 POST /sync 拿 job_id 后启动轮询。silent=true 用于自动同步，
  // 失败时不弹错（只静默）。syncJobRef 既是入口互斥锁也是轮询追踪 id，
  // 'pending' 表示已发起但还没拿到 job_id（挡住连点 + 自动与手动并发）。
  const fireSync = useCallback(async (
    device: RecordingDeviceConfig,
    silent: boolean,
  ) => {
    if (syncJobRef.current !== null) return
    setSyncJob('pending')
    try {
      const { job_id } = await recordingApi.syncDevice({
        device_type: device.device_type as DeviceType,
        device_id: device.id,
      })
      setSyncJob(job_id)
      startSyncPoll()
    } catch (e: any) {
      setSyncJob(null)
      if (silent) return
      const code = e?.code ?? e?.response?.data?.code
      if (code === 4) {
        message.warning('同步任务进行中，请稍后再试')
      } else {
        const msg = e?.response?.data?.message || e?.message || '同步失败'
        message.error(msg)
      }
    }
  }, [setSyncJob, startSyncPoll])

  // 手动同步：探测 + 阻挡不可用设备。只同步当前 active 设备。
  const handleSync = useCallback(() => {
    if (!activeDevice) {
      message.warning('请先接入设备')
      return
    }
    void probeDevice(activeDevice.device_type as DeviceType)
    if (activeDeviceStatus && !activeDeviceStatus.available) {
      message.warning(activeDeviceStatus.reason || '设备不可用，无法同步')
      return
    }
    void fireSync(activeDevice, false)
  }, [activeDevice, activeDeviceStatus, fireSync, probeDevice])

  // 自动同步（页面进入 / 新增换 key 后）：一次只同步 active 设备。
  // 流程：探测 active 设备的可用性 → 不可用或未知则跳过 → 可用才 fireSync。
  // - 默认：本次挂载只触发一次（autoSyncedRef）
  // - force=true：用户主动保存/换 key 时强制触发，绕过 autoSyncedRef
  // - 探测 stale 或网络失败 → null → 跳过（保守策略：宁可漏一次不可滥发）
  // 后端是「每用户单 job」契约，所以同一时刻只会跑一个 active。
  // autoSyncedRef 必须在 probe 之前置 true：probe 是 0~300ms 的网络等待，
  // 期间 force=true 第二次调用进来时会被它挡住，避免同 type 并发 probe 浪费。
  const tryAutoSync = useCallback(async (list: RecordingDeviceConfig[], opts: { force?: boolean } = {}) => {
    if (autoSyncedRef.current && !opts.force) return
    const active = list.find((d) => d.is_active && d.enabled)
    if (!active) return
    autoSyncedRef.current = true
    const status = await probeDevice(active.device_type as DeviceType)
    if (!status || !status.available) return  // 不可用 / 未知 → 不同步
    void fireSync(active, true)
  }, [fireSync, probeDevice])

  // 进入页面：先问「同步状态」再问「设备列表」，最后才决定要不要自动同步。
  // 必须串行：自动同步的触发条件是「后端没在跑」+「active 设备可用」，
  // 所以得按顺序拿到状态、设备、探测结果。
  // - 后端已在跑 → 接管轮询（避免重复触发 + 防重入弹错）
  // - 后端没在跑 → 拉设备 → 兜底激活 → tryAutoSync（内部探测 + 判可用 + fire）
  // 状态接口失败视作「没活跃任务」继续往下；设备接口失败则保持空列表。
  // 这个 effect 放在 fireSync/finishSync 定义之后，依赖稳定。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Step 1：状态接口必须先回来
      let status: SyncStatusResponse | null = null
      try {
        status = await recordingApi.getSyncStatus()
      } catch {
        // 网络失败：当作「无活跃任务」，继续走自动同步路径
      }
      if (cancelled) return

      let activeJobId: string | null = null
      if (status?.status === 'running') {
        activeJobId = status.job_id
        setSyncJob(activeJobId)
        startSyncPoll()
      }

      // Step 2：状态确认后，才拉设备列表
      let loaded: RecordingDeviceConfig[] = []
      try {
        loaded = await recordingApi.getDevices()
      } catch {
        // 拉取失败：保持空列表
      }
      if (cancelled) return

      loaded = await ensureActiveDevice(loaded)
      if (cancelled) return
      setDevices(loaded)

      // Step 3：仍然没有活跃任务 → tryAutoSync（内部探测 + 判可用 → fire）
      if (!activeJobId) await tryAutoSync(loaded)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 打开接入弹窗：mode='add' 时初始化默认值；mode='edit' 时回填目标 device。
  // 把 editingDeviceId 设到 state 驱动 ConnectDeviceModal 的标题/字段 disabled。
  const openConnectModal = useCallback(
    async (mode: 'add' | 'edit', editingId?: string) => {
      const isEdit = mode === 'edit' && editingId
      setEditingDeviceId(isEdit ? editingId! : null)
      setConnectModalVisible(true)
      const target = isEdit ? devices.find((d) => d.id === editingId) : null
      try {
        connectForm.setFieldsValue({
          brand: (target?.device_type ?? SONICNOTE_DEVICE_TYPE) as DeviceType,
          apiKey: '',
        })
      } catch {
        connectForm.setFieldsValue({
          brand: SONICNOTE_DEVICE_TYPE,
          apiKey: '',
        })
      }
    },
    [connectForm, devices],
  )

  // 关闭弹窗：清空 editing 状态
  const closeConnectModal = useCallback(() => {
    setConnectModalVisible(false)
    setEditingDeviceId(null)
    connectForm.resetFields()
  }, [connectForm])

  // 提交接入/编辑：edit 模式走 PUT /devices/{id}；add 模式走 POST /devices。
  // 成功后 reload 设备列表 + 探测本次操作的 type；新增或换 key 时强制自动同步一次。
  const handleConnectConfirm = async () => {
    let values: { brand: RecordingDeviceConfig['device_type']; apiKey: string }
    try {
      values = await connectForm.validateFields()
    } catch {
      return
    }
    setConnectLoading(true)
    try {
      // force 触发条件：本次操作"实质性改变了自动同步的目标 / 远端账号"。
      // - 新增设备 + 操作前没有任何 active：新增必变唯一 active，且新设备尚未自动同步过 → force
      // - 新增设备 + 操作前已有 active：后端不切换激活（"用户首条配置自动 is_active=true；后续新增不自动切换激活"），
      //   自动同步的还是老 active，它刚 init 时已同步过，本次没必要重跑 → 不 force
      // - 编辑 active 设备 + key 真改了：远端账号变了，重拉合理 → force
      // - 其他：active 设备和远端账号都没变 → 不 force
      const wasActiveBefore = devices.some((d) => d.is_active)
      const edited = editingDeviceId ? devices.find((d) => d.id === editingDeviceId) : null
      const isKeyChanged = !!edited?.is_active
        && values.apiKey.length > 0
        && values.apiKey !== edited?.api_key
      const force = (!editingDeviceId && !wasActiveBefore) || isKeyChanged

      if (editingDeviceId) {
        // 编辑模式：走 PUT /devices/{id}。apiKey 留空 = 不修改。
        await recordingApi.updateDeviceById(editingDeviceId, { api_key: values.apiKey })
        message.success('已更新')
      } else {
        // 新增模式：走 POST /devices。apiKey 必填（前端已校验）
        await recordingApi.createDevice({
          device_type: values.brand as DeviceType,
          api_key: values.apiKey,
          enabled: true,
        })
        message.success('已接入')
      }
      closeConnectModal()
      // reload 设备：兜底激活 + 写入 state 全部内化；拉取失败时退回当前列表
      const loaded = await reloadDevices(devices)
      // tryAutoSync 内部探测 active 设备并判可用性 → 不可用就跳过 → 可用才 fire。
      // 探测的 type 是「最终会被同步的那台」的 type，不是用户刚操作的 type
      // （首条配置时两者一致；后续新增不切激活时是已有 active 的 type）。
      await tryAutoSync(loaded, { force })
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || (editingDeviceId ? '更新失败' : '接入失败')
      message.error(msg)
    } finally {
      setConnectLoading(false)
    }
  }

  // 「我的设备」浮层回调：
  // - 编辑：打开弹窗（编辑模式），回填 device_type
  // - 添加：打开弹窗（新增模式），brand 默认 SonicNote
  // - 设当前：调 setActiveDevice，切换 is_active 标记
  // - 移除：调 deleteDeviceById；若删的是 active 设备，自动激活剩余第一个 enabled
  const handleEditDevice = useCallback(
    (id: string) => {
      setDeviceListOpen(false)
      void openConnectModal('edit', id)
    },
    [openConnectModal],
  )

  const handleAddDevice = useCallback(() => {
    setDeviceListOpen(false)
    void openConnectModal('add')
  }, [openConnectModal])

  const handleSetActiveDevice = useCallback(
    (id: string) => {
      const target = devices.find((d) => d.id === id)
      if (!target) return
      if (activeDevice?.id === target.id) return
      // 切换激活设备属于破坏性操作（自动同步链路随之改变），
      // 按 spec 在执行前弹确认。后端 setActiveDevice 幂等，无需前端防双击；
      // 用户连续切两次会触发两个 Modal，由用户决定取消哪个。
      Modal.confirm({
        title: '切换当前激活设备？',
        content: `切换后将使用「${target.api_key}」作为当前激活设备，自动同步会改从此设备拉取。`,
        okText: t('action.confirm'),
        cancelText: t('action.cancel'),
        onOk: async () => {
          try {
            await recordingApi.setActiveDevice(id)
            const list = await reloadDevices(devices)
            // force=true：用户切完就该拉新设备的数据，不等手动点同步
            await tryAutoSync(list, { force: true })
          } catch (e: any) {
            const msg = e?.response?.data?.message || e?.message || '切换激活设备失败'
            message.error(msg)
          }
        },
      })
    },
    [devices, reloadDevices, tryAutoSync],
  )

  const handleRemoveDevice = useCallback(
    async (id: string) => {
      const target = devices.find((d) => d.id === id)
      if (!target) return
      setDeviceListOpen(false)
      Modal.confirm({
        title: '删除设备',
        content: '是否确认删除该设备，该设备下的会话和数据将保留',
        okText: t('action.confirm'),
        cancelText: t('action.cancel'),
        onOk: async () => {
          try {
            await recordingApi.deleteDeviceById(id)
          } catch (e: any) {
            const msg = e?.response?.data?.message || e?.message || '移除失败'
            message.error(msg)
            return
          }
          // 拉取失败时退回"本地移除该条"——保证 UI 至少反映出"已删除"；
          // ensureActiveDevice 会处理"删了激活设备 / 列表无 active"两种兜底
          await reloadDevices(devices.filter((d) => d.id !== id))
          message.success('已删除')
        },
      })
    },
    [devices, reloadDevices],
  )

  return (
    <div className="flex h-full">
      {/* 左栏 */}
      <ResponsiveSidebar className="pt-4 bg-white border-r border-[#EDEEF0]">
        {({ close }) => (
          <>
            <div className='h-10 flex items-center justify-between px-3'>
          <Popover
            open={deviceListOpen}
            onOpenChange={handleDeviceListOpenChange}
            trigger="click"
            placement="bottomLeft"
            arrow={false}
            content={
              <DeviceListPopover
                devices={devices}
                deviceStatusMap={deviceStatusMap}
                onEdit={handleEditDevice}
                onSetActive={handleSetActiveDevice}
                onAdd={handleAddDevice}
                onRemove={handleRemoveDevice}
              />
            }
          >
            <div
              className={[
                'text-sm text-primary flex items-center gap-1.5',
                // 已接入数据才允许点击浮层；未接入时关闭 cursor/hover 反馈
                hasDeviceData ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
              ].join(' ')}
            >
              <SvgIcon name="devices" />
              {/* 已配置：显示 active 设备的品牌 label；未配置：保持"录音设备" */}
              {activeDevice
                ? BRAND_OPTIONS.find((b) => b.value === activeDevice.device_type)?.label ?? '录音设备'
                : '录音设备'}
              {/* 已绑定 Key 且已探测完成 → 显示绿/红小点（按 active 设备的 type）。
                  红色时鼠标悬停查看 reason（key_invalid / 设备未启用 / network_error 等）。 */}
              {activeDevice?.api_key && activeDeviceStatus && (
                activeDeviceStatus.available ? (
                  <span
                    className="inline-block size-2 rounded-full bg-green-500"
                    aria-label="设备可用"
                  />
                ) : (
                  <Tooltip title={activeDeviceStatus.reason || '设备不可用'} placement="top">
                    <span
                      className="inline-block size-2 rounded-full bg-red-500 cursor-pointer"
                      aria-label="设备不可用"
                    />
                  </Tooltip>
                )
              )}
            </div>
          </Popover>
          {/* 没有任何设备 → "接入"引导 */}
          {devices.length === 0 ? (
            <div
              className="flex items-center gap-1 text-sm text-[#6B7280] cursor-pointer hover:text-primary"
              onClick={() => openConnectModal('add')}
            >
              <SvgIcon name="equalizer" className="rotate-90" />
              接入
            </div>
          ) : (
            // 有设备：显示同步按钮（同步 active）；同步中或 active 设备探测不可用时禁用
            <Button
              color="primary"
              variant="link"
              onClick={handleSync}
              disabled={syncing || !!(activeDeviceStatus && !activeDeviceStatus.available)}
              className="px-0"
              icon={syncing ? <LoadingOutlined spin /> : <RedoOutlined />}
            >
              {syncing ? '同步中' : '同步'}
            </Button>
          )}
        </div>
        <div className="w-full px-3 mt-2">
          {hasActiveRecording ? (
            <div className="flex flex-col gap-2">
              {isTransitioning || recordingStatus === 'finalizing' ? (
                <>
                  <button
                    disabled
                    className="flex items-center justify-center gap-1.5 h-[32px] px-4 rounded-lg bg-gray-100 text-[13px] text-gray-400 cursor-not-allowed"
                  >
                    <SvgIcon name="pause" size={14} />
                    <span>暂停</span>
                  </button>
                  <button
                    disabled
                    className="flex items-center justify-center gap-1.5 h-[32px] px-4 rounded-lg bg-gray-100 text-[13px] text-gray-400 cursor-not-allowed"
                  >
                    <SvgIcon name="power" size={14} />
                    <span>结束</span>
                  </button>
                </>
              ) : recordingStatus === 'interrupted' ? (
                <button
                  className="flex items-center justify-center gap-1.5 h-[32px] px-4 rounded-lg bg-white border border-gray-200 text-[13px] text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                  onClick={() => useRecordingStore.getState().recoverInterrupted(true, enableSystemAudio)}
                >
                  <SvgIcon name="play-one" size={14} />
                  <span>恢复</span>
                </button>
              ) : recordingStatus === 'recording' ? (
                <button
                  className="flex items-center justify-center gap-1.5 h-[32px] px-4 rounded-lg bg-white border border-gray-200 text-[13px] text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                  onClick={() => useRecordingStore.getState().pause()}
                >
                  <SvgIcon name="pause" size={14} />
                  <span>暂停</span>
                </button>
              ) : (
                <button
                  className="flex items-center justify-center gap-1.5 h-[32px] px-4 rounded-lg bg-white border border-gray-200 text-[13px] text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                  onClick={() => useRecordingStore.getState().resume()}
                >
                  <SvgIcon name="play-one" size={14} />
                  <span>继续</span>
                </button>
              )}
              {!(isTransitioning || recordingStatus === 'finalizing') && (
                <button
                  className="flex items-center justify-center gap-1.5 h-[32px] px-4 rounded-lg bg-[#ff4d4f] text-[13px] text-white hover:bg-red-500 transition-colors shadow-sm border border-transparent"
                  onClick={() => useRecordingStore.getState().finish()}
                >
                  <SvgIcon name="power" size={14} color="#ffffff" />
                  <span>结束</span>
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {false && showRecordingButton && isSystemAudioSupported && (
                <div className="flex flex-col gap-1">
                  <Checkbox
                    checked={enableSystemAudio}
                    onChange={(e) => setEnableSystemAudio(e.target.checked)}
                  >
                    {t('recording.system_audio')}
                  </Checkbox>
                  {enableSystemAudio && (
                    <div className="text-[12px] text-secondary pl-6 leading-4">
                      {t('recording.system_audio_hint')}
                    </div>
                  )}
                </div>
              )}
              {showRecordingButton && (
                <Button type="primary" icon={<SvgIcon name="voice-one" size={18} />} onClick={handleStartRecording}>
                  {t('mine.record_btn')}
                </Button>
              )}
              <Button
                onClick={audioImport.handleImportFile}
                loading={audioImport.importing}
                icon={<SvgIcon name="download" size={16} />}
              >
                {t('mine.import')}
              </Button>
            </div>
          )}
        </div>

        <div className="px-3 mt-3">
          <button
            type="button"
            onClick={() => {
              goToHome();
              close();
            }}
            className={[
              'w-full h-9 flex items-center gap-2 px-3 rounded-lg text-left text-[13px] transition-colors',
              !selectedFileId && !cognitionMatch
                ? 'bg-[#E0EAFF] text-[#2563EB]'
                : 'text-[#334155] hover:bg-[#EEF4FF] hover:text-[#2563EB]',
            ].join(' ')}
          >
            <SvgIcon name="home" size={16} />
            <span>经营记忆</span>
          </button>
        </div>

        <div className="px-3 mt-1">
          <button
            type="button"
            onClick={() => {
              goToCognition();
              close();
            }}
            className={[
              'w-full h-9 flex items-center gap-2 px-3 rounded-lg text-left text-[13px] transition-colors',
              cognitionMatch
                ? 'bg-[#E0EAFF] text-[#2563EB]'
                : 'text-[#334155] hover:bg-[#EEF4FF] hover:text-[#2563EB]',
            ].join(' ')}
          >
            <SvgIcon name="brain" size={16} />
            <span>认知模型</span>
            {cognitionPendingCount > 0 && (
              <span
                className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#FF4D4F] px-1 text-[11px] font-medium leading-none text-white"
                aria-label={`${cognitionPendingCount} 条待确认认知`}
              >
                {cognitionPendingCount > 99 ? '99+' : cognitionPendingCount}
              </span>
            )}
          </button>
        </div>

        <div className="px-3 mt-2 pb-2">
          <Input
            allowClear
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            placeholder="搜索"
            prefix={<SearchOutlined />}
          />
        </div>

        <div className="px-3 pb-2">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] text-secondary">分类</div>
            <div className="flex items-center gap-1">
              <Dropdown
                menu={{ items: sortMenuItems, onClick: ({ key }) => setSortOrder(key as 'updated_time' | 'created_time') }}
                trigger={['click']}
                placement="bottomLeft"
              >
                <div className="size-5 text-secondary flex items-center justify-center rounded hover:border cursor-pointer">
                  <SvgIcon name="sort-one" />
                </div>
              </Dropdown>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {categoryTags.map((tag) => {
              const isActive = activeCategoryTag === tag.key
              return (
                <div
                  key={tag.key}
                  onClick={() => setActiveCategoryTag(tag.key)}
                  className={[
                    'px-3 h-7 leading-7 text-xs rounded-xl cursor-pointer transition-colors',
                    isActive
                      ? 'bg-[#E0EAFF] text-[#2563EB]'
                      : 'bg-[#F2F3F5] text-secondary hover:bg-[#E5E6EB]',
                  ].join(' ')}
                >
                  {tag.label}
                </div>
              )
            })}
            <Button color="primary" variant='link' size="small" onClick={() => groupDialogRef.current?.open()}>{t('action.manage')}</Button>
          </div>
        </div>

        {/* 音频解析待处理任务 */}
        {queuedCount > 0 && (
          <div className="px-3">
            <div className="px-3 py-2 mb-2 flex items-center gap-1.5 text-[13px] text-secondary bg-[#F5F6F7] rounded-md">
              <LoadingOutlined className="text-[#2563EB]" />
              音频解析队列中{queuedCount}个待处理任务
            </div>
          </div>
        )}

        {/* 文件列表 */}
        <RecordingFileList
          list={fileList}
          loading={loading}
          selectedId={selectedFileId}
          onSelect={(item) => {
            handleSelect(item);
            close();
          }}
          onCommand={handleListCommand}
          hasMore={hasMore}
          onLoadMore={loadMore}
          categoryTags={categoryTags}
        />
          </>
        )}
      </ResponsiveSidebar>

      {/* 右栏：由子路由决定（index=经营记忆 / cognition=认知模型 / preview=录音预览） */}
      <Outlet context={outletContext} />

      {/* 隐藏 file input for audio import */}
      <input
        type="file"
        ref={audioImport.fileInputRef}
        accept={AUDIO_ACCEPT}
        multiple
        onChange={audioImport.handleFileChange}
        style={{ display: 'none' }}
      />

      {/* Rename Modal */}
      <Modal
        title={t('action.rename')}
        open={renameModalVisible}
        onOk={handleRenameConfirm}
        onCancel={() => {
          setRenameModalVisible(false)
          setRenamingItem(null)
        }}
        okText={t('action.confirm')}
        cancelText={t('action.cancel')}
      >
        <Input
          value={renameValue}
          onChange={(e) => {
            const v = e.target.value
            if (!/[\/\\]/.test(v)) setRenameValue(v)
          }}
          placeholder={t('common.file_name')}
          onPressEnter={handleRenameConfirm}
        />
      </Modal>

      {/* 接入 / 编辑设备弹窗（双模式：editingDevice 为 null = 新增，否则 = 编辑） */}
      <ConnectDeviceModal
        open={connectModalVisible}
        loading={connectLoading}
        connectForm={connectForm}
        editingDevice={editingDevice}
        onOk={handleConnectConfirm}
        onCancel={closeConnectModal}
      />

      {/* 分组 */}
      <GroupDialog
        ref={groupDialogRef}
        groupType={GROUP_TYPE.RECORDING_FILE}
        onChange={() => loadGroups()}
      />
    </div>
  )
}

export default RecordingView
