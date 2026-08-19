import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Navigate, Outlet, useMatch, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Checkbox, Form, Input, Modal, Dropdown, Tooltip, message } from 'antd'
import { SearchOutlined, RedoOutlined, LoadingOutlined } from "@ant-design/icons"
import type { MenuProps } from 'antd'
import { useEnv } from '@/hooks/useEnv'
import { usePoll } from '@/hooks/usePoll'
import { checkVersion } from '@/utils/version'
import { VERSION_MODULE } from '@/constants/enterprise'
import { useRecordingStore } from '@/stores/modules/recording'
import recordingApi from '@/api/modules/recording'
import { buildUrl } from '@/utils/router'
import { t } from '@/locales'
import { useMySpaceContext } from '@/views/mine/hooks/useMySpaceContext'
import { useAudioImport } from '@/views/mine/hooks/useAudioImport'
import { AUDIO_ACCEPT } from '@/views/mine/constants'
import type {
  RecordingDeviceConfig,
  RecordingDeviceStatusResponse,
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
import { SvgIcon } from "@km/shared-components-react"
import { useLibraryStore } from '@/stores/modules/library'
import agentsApi from '@/api/modules/agents'
import { AGENT_USAGES } from '@/constants/agent'
import { BRAND_OPTIONS, SONICNOTE_DEVICE_TYPE } from './constants/brandOptions'
import { MAX_AUDIO_IMPORT_SIZE } from './constants/recordingLimits'
import { ConnectDeviceModal } from './components/brand/ConnectDeviceModal'

// 从分组数据构建分类标签（前置"全部"选项）
const groupsToTags = (groups: Group[]): { key: string; label: string }[] => [
  { key: '0', label: '全部' },
  ...groups
    .filter((g) => g.group_name.trim())
    .map((g) => ({ key: String(g.group_id), label: g.group_name })),
]

/** 从设备列表里挑出 SonicNote 配置（找不到返回 null） */
const findSonicnote = (list: RecordingDeviceConfig[]) =>
  list.find((d) => d.device_type === SONICNOTE_DEVICE_TYPE) ?? null

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
  const hasRecording = checkVersion(VERSION_MODULE.RECORDING)
  const recordingStatus = useRecordingStore((s) => s.status)
  const isTransitioning = useRecordingStore((s) => s.isTransitioning)
  const prevRecordingStatusRef = useRef(recordingStatus)

  // 搜索：keywordInput 即时更新，keyword 防抖后驱动取数
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState<RecordingFilter>('all')
  const [enableSystemAudio, setEnableSystemAudio] = useState(false)

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

  // 当前用户的 SonicNote 设备配置（用于决定左栏显示"接入"还是"同步"）
  const [sonicnoteDevice, setSonicnoteDevice] = useState<RecordingDeviceConfig | null>(null)
  // 同步状态：是否正在同步（job_id 存在且未终态）
  const [syncing, setSyncing] = useState(false)
  // 当前追踪的同步 job_id（放进 ref 而非 state：轮询回调需要稳定读取，
  // 且不影响 UI 重渲染）
  const syncJobIdRef = useRef<string | null>(null)
  // 同步进行中的同步标记：用 ref 而非 state 是为了在 fireSync 入口
  // 同步判断"是否已经在飞"，避免 race（用户连点 / 自动与手动并发）。
  // setSyncing 是异步的，闭包里读到的 syncing 仍是旧值。
  const syncingRef = useRef(false)
  // 自动同步是否已触发过：防止同一会话内重复触发。
  // 页面刷新会重新挂载组件，ref 自动重置——这与"进入页面自动同步一次"语义一致。
  const autoSyncTriggeredRef = useRef(false)
  // refresh 引用：轮询回调里调用 refresh 要用最新版本，避免闭包陷阱
  // （refresh 依赖 keyword/sortBy/groupId，组件重渲染时它会重新生成）
  // 必须先 createRef(null) —— 见下方 useRecordingList 之后的位置再绑定 current
  const refreshRef = useRef<(() => void) | null>(null)

  // 设备可用性探测结果：null 表示尚未探测或探测失败
  // 探测失败时不清空旧值，避免把一个"已知可用"的设备瞬间显示成"不可用"
  const [deviceStatus, setDeviceStatus] = useState<RecordingDeviceStatusResponse | null>(null)
  // 探测会话 id：避免后发的慢请求覆盖先发的快请求结果
  const probeIdRef = useRef(0)

  // 实时探测设备可用性（不缓存）。
  // 触发时机：1) 页面初始加载若已有 api_key；2) 绑定 Key 成功后；
  //         3) 同步前；4) 打开配置弹窗时。
  // 探测失败（HTTP/网络异常）时保留旧状态，避免误把"已知可用"的设备瞬间显示成
  // "不可用"——真正的网络错误会由后端通过 reason=network_error 返回，不走 reject 分支。
  const probeDevice = useCallback(async (deviceType: RecordingDeviceConfig['device_type']) => {
    const id = ++probeIdRef.current
    try {
      const status = await recordingApi.getDeviceStatus(deviceType)
      // 仅当本次探测仍是最新一次时写回，避免晚回来的慢请求覆盖新结果
      if (id === probeIdRef.current) {
        setDeviceStatus(status)
      }
    } catch {
      // 网络/服务不可达：保留旧 deviceStatus，不更新
    }
  }, [])

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
  // refresh 定义后才能绑定
  refreshRef.current = refresh

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

  // 左栏"首页"入口：回到 /recording 索引路由，右栏渲染 embedded 会议记忆首页
  const goToHome = () => {
    navigate('/recording')
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

  // 单次同步轮询：由 usePoll 每 2s 调用一次；终态时主动 stop
  // 通过 syncJobIdRef 判断"是否在追踪的本次 job"，避免与历史/并发任务混淆
  const syncPollTick = useCallback(async () => {
    const jobId = syncJobIdRef.current
    if (!jobId) return
    try {
      const status = await recordingApi.getSyncStatus()
      if (!status || status.job_id !== jobId) return
      if (status.status === 'completed') {
        stopSyncPoll()
        syncJobIdRef.current = null
        syncingRef.current = false
        setSyncing(false)
        message.success(
          `同步完成，共发现 ${status.discovered} 条，新增 ${status.imported} 条，失败 ${status.failed} 条`,
        )
        // 同步成功可能导入了新文件，刷新列表
        refreshRef.current?.()
      } else if (status.status === 'failed') {
        stopSyncPoll()
        syncJobIdRef.current = null
        syncingRef.current = false
        setSyncing(false)
        message.error(status.error_message || '同步失败')
      } else if (status.status === 'interrupted') {
        // 服务重启导致的后台任务中断（非用户操作）。
        // 复用现有"同步"按钮即可重试：用户从 enabled 设备点同步 → fireSync。
        stopSyncPoll()
        syncJobIdRef.current = null
        syncingRef.current = false
        setSyncing(false)
        message.warning('上次同步被中断，请点击同步重新尝试')
      }
      // pending / running 继续轮询
    } catch {
      // 单次失败不打断，下一轮继续
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 同步状态轮询：2s 一次，组件卸载时由 usePoll 自动 stop
  const { start: startSyncPoll, stop: stopSyncPoll } = usePoll(syncPollTick, 2000)

  // 进入页面时同时拉设备配置 + 检查是否还有未结束的同步任务。
  // - 若已有活跃任务 → 接管轮询（避免每次刷新都重复触发后端任务）
  // - 否则设备已启用 → 自动触发一次同步（失败静默）
  // 同时拉两个接口，避免串行带来的两段状态更新闪烁；
  // 用 allSettled 防止其中一个失败带垮另一个。
  useEffect(() => {
    ;(async () => {
      const [statusResult, devicesResult] = await Promise.allSettled([
        recordingApi.getSyncStatus(),
        recordingApi.getDevices(),
      ])

      // 检查后端是否已经在同步
      let activeJobId: string | null = null
      if (statusResult.status === 'fulfilled') {
        const status = statusResult.value
        if (status && status.status === 'running') {
          activeJobId = status.job_id
          syncJobIdRef.current = activeJobId
          syncingRef.current = true
          setSyncing(true)
          startSyncPoll()
          // 后端已在同步视作"自动触发已生效"，避免后续 tryAutoSync 重复触发
          autoSyncTriggeredRef.current = true
        }
      }

      // 拉一次设备配置，决定后续是否走自动同步
      let sonicnote: RecordingDeviceConfig | null = null
      if (devicesResult.status === 'fulfilled') {
        sonicnote = findSonicnote(devicesResult.value)
        setSonicnoteDevice(sonicnote)
      }

      // 已绑定 Key → 探测一次可用性（用户进入页面就看到红/绿小点）
      if (sonicnote?.api_key) probeDevice(SONICNOTE_DEVICE_TYPE)

      // 已有活跃同步时不再触发；否则设备启用则自动触发一次
      if (!activeJobId) await tryAutoSync(sonicnote)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 打开接入弹窗：每次打开都重新拉一次，避免后端配置变更后回填失真
  // 用本次 API 返回值直接回填表单，避开 setSonicnoteDevice 后 re-render
  // 还没完成时的闭包陷阱（旧 state 仍然是上一份数据）
  // 打开弹窗时也刷新一次设备可用性探测——用户在进入配置前通常想看最新状态
  const openConnectModal = useCallback(async () => {
    setConnectModalVisible(true)
    try {
      connectForm.setFieldsValue({
        brand: SONICNOTE_DEVICE_TYPE,
        apiKey: '',
      })
    } catch {
      // 网络失败时用最近一次的本地配置兜底，避免弹窗打开时一片空白
      connectForm.setFieldsValue({
        brand: SONICNOTE_DEVICE_TYPE,
        apiKey: sonicnoteDevice?.api_key ?? '',
      })
    }
  }, [connectForm, sonicnoteDevice])

  // 提交接入：保存到 PUT /devices，刷新本地配置，接入成功后自动同步一次
  const handleConnectConfirm = async () => {
    let values: { brand: RecordingDeviceConfig['device_type']; apiKey: string }
    try {
      values = await connectForm.validateFields()
    } catch {
      return
    }
    setConnectLoading(true)
    try {
      await recordingApi.putDevice({
        device_type: values.brand,
        // 后端约定：空字符串视为"不修改、保留原值"
        api_key: values.apiKey,
        enabled: true,
      })
      message.success('已接入')
      setConnectModalVisible(false)
      connectForm.resetFields()
      // 重新拉一次设备：把最新的 api_key 回灌进 sonicnoteDevice state，
      // 同时拿 fresh 的设备对象用于自动同步（避开 state 更新延迟）
      let sonicnote: RecordingDeviceConfig | null = null
      try {
        const list = await recordingApi.getDevices()
        sonicnote = findSonicnote(list)
        setSonicnoteDevice(sonicnote)
      } catch {
        // 拉取失败时退回旧值，至少不影响弹窗的成功提示
        sonicnote = sonicnoteDevice
      }
      // 接入成功后自动触发一次同步（失败静默，不弹错）。
      // force=true：用户主动保存/换 key，绕过同会话内只能自动同步一次的去重，
      // 否则在用户改完 key 后自动同步会被 autoSyncTriggeredRef 拦掉。
      // 探测与自动同步并行：探测只更新状态点，不阻塞同步流程。
      const [, ] = await Promise.allSettled([
        tryAutoSync(sonicnote, { force: true }),
        probeDevice(SONICNOTE_DEVICE_TYPE),
      ])
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || '接入失败'
      message.error(msg)
    } finally {
      setConnectLoading(false)
    }
  }

  // 触发同步的核心：调 POST /sync-sonicnote 拿到 job_id 后启动轮询。
  // emitErrorToast=false 用于自动同步场景（不希望弹错，只在静默状态里失败）。
  // 入口用 syncingRef 而非 syncing state，避免 setSyncing 异步更新带来的
  // "读旧值再双开 fireSync" 的 race；轮询终态分支里已经同步复位 syncingRef。
  const fireSync = useCallback(async (emitErrorToast: boolean) => {
    if (syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)
    try {
      const { job_id } = await recordingApi.syncSonicNote({})
      syncJobIdRef.current = job_id
      startSyncPoll()
    } catch (e: any) {
      syncingRef.current = false
      setSyncing(false)
      if (emitErrorToast) {
        const code = e?.code ?? e?.response?.data?.code
        if (code === 4) {
          message.warning('同步任务进行中，请稍后再试')
        } else {
          const msg = e?.response?.data?.message || e?.message || '同步失败'
          message.error(msg)
        }
      }
    }
  }, [startSyncPoll])

  // 手动点击同步：未接入设备给出引导；其余交给 fireSync
  const handleSync = useCallback(async () => {
    if (!sonicnoteDevice?.enabled) {
      message.warning('请先接入设备')
      return
    }
    // 探测结果若已确认不可用 → 阻止同步，避免发起必失败的同步任务
    if (deviceStatus && !deviceStatus.available) {
      message.warning(deviceStatus.reason || '设备不可用，无法同步')
      return
    }
    // 同步前再探测一次可用性，更新状态点（不阻塞同步）
    probeDevice(SONICNOTE_DEVICE_TYPE)
    await fireSync(true)
  }, [sonicnoteDevice, deviceStatus, fireSync, probeDevice])

  // 静默自动同步：用于进入页面与接入成功两个时机。
  // - 默认（同会话内一次）：进入页面触发后，本次会话不再自动触发，
  //   防止刷新或频繁切页造成重复同步。
  // - force=true：用户主动保存接入/换 key 时强制触发，绕过 ref 去重。
  //   设备未启用 / 已在同步 仍会被跳过（避免重复触发）。
  const tryAutoSync = useCallback(async (
    device: RecordingDeviceConfig | null,
    opts: { force?: boolean } = {},
  ) => {
    const { force = false } = opts
    if (!force && autoSyncTriggeredRef.current) return
    if (syncingRef.current) return
    if (!device?.enabled) return
    autoSyncTriggeredRef.current = true
    await fireSync(false)
  }, [fireSync])

  return (
    <div className="flex h-full">
      {/* 左栏 */}
      <div className="flex-shrink-0 w-[280px] h-full pt-4 bg-white border-r border-[#EDEEF0] flex flex-col">
        <div className='h-10 flex items-center justify-between px-3'>
          <div
            className="text-sm text-primary flex items-center gap-1.5 cursor-pointer hover:opacity-80"
            onClick={openConnectModal}
            title={sonicnoteDevice ? '点击修改设备配置' : '点击接入设备'}
          >
            <SvgIcon name="devices" />
            {/* 已配置：显示品牌 label；未配置：保持"录音设备" */}
            {sonicnoteDevice
              ? BRAND_OPTIONS.find((b) => b.value === sonicnoteDevice.device_type)?.label ?? '录音设备'
              : '录音设备'}
            {/* 已绑定 Key 且已探测完成 → 显示绿/红小点。
                红色时鼠标悬停查看 reason（key_invalid / 设备未启用 / network_error 等）。 */}
            {sonicnoteDevice?.api_key && deviceStatus && (
              deviceStatus.available ? (
                <span
                  className="inline-block size-2 rounded-full bg-green-500"
                  aria-label="设备可用"
                />
              ) : (
                <Tooltip title={deviceStatus.reason || '设备不可用'} placement="top">
                  <span
                    className="inline-block size-2 rounded-full bg-red-500 cursor-pointer"
                    aria-label="设备不可用"
                  />
                </Tooltip>
              )
            )}
          </div>
          {/* 已配置但未启用 → "接入"引导；未配置 → "接入" */}
          {(!sonicnoteDevice || !sonicnoteDevice.enabled) ? (
            <div
              className="flex items-center gap-1 text-sm text-[#6B7280] cursor-pointer hover:text-primary"
              onClick={openConnectModal}
            >
              <SvgIcon name="equalizer" className="rotate-90" />
              接入
            </div>
          ) : (
            // 已启用：显示同步按钮；同步中或设备探测不可用时禁用
            <Button
              color="primary"
              variant="link"
              onClick={handleSync}
              disabled={syncing || (!!deviceStatus && !deviceStatus.available)}
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
            onClick={goToHome}
            className={[
              'w-full h-9 flex items-center gap-2 px-3 rounded-lg text-left text-[13px] transition-colors',
              !selectedFileId
                ? 'bg-[#E0EAFF] text-[#2563EB]'
                : 'text-[#334155] hover:bg-[#EEF4FF] hover:text-[#2563EB]',
            ].join(' ')}
          >
            <SvgIcon name="home" size={16} />
            <span>首页</span>
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
          onSelect={handleSelect}
          onCommand={handleListCommand}
          hasMore={hasMore}
          onLoadMore={loadMore}
          categoryTags={categoryTags}
        />
      </div>

      {/* 右栏：由子路由决定（index=会议记忆首页 / preview/:fileId=录音预览） */}
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

      {/* 接入弹窗 */}
      <ConnectDeviceModal
        open={connectModalVisible}
        loading={connectLoading}
        connectForm={connectForm}
        sonicnoteDevice={sonicnoteDevice}
        onOk={handleConnectConfirm}
        onCancel={() => {
          setConnectModalVisible(false)
          connectForm.resetFields()
        }}
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
