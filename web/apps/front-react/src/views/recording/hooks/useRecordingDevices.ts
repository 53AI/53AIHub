import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Form, Modal, message } from 'antd'
import type { FormInstance } from 'antd'
import recordingApi from '@/api/modules/recording'
import { t } from '@/locales'
import { usePoll } from '@/hooks/usePoll'
import type {
  RecordingDeviceConfig,
  RecordingDeviceStatusResponse,
  SyncStatusResponse,
} from '@/api/modules/recording/types'
import { SONICNOTE_DEVICE_TYPE, type DeviceType } from '../constants/brandOptions'

export interface UseRecordingDevicesOptions {
  /** 同步完成后的回调（刷新录音文件列表） */
  onSyncComplete: () => void
}

export interface UseRecordingDevicesReturn {
  /** 当前用户的全部设备配置（多 type + 多 key） */
  devices: RecordingDeviceConfig[]
  /** 当前激活设备（后端 is_active 标记） */
  activeDevice: RecordingDeviceConfig | null
  /** 激活设备的可用性探测结果（绿/红状态点） */
  activeDeviceStatus: RecordingDeviceStatusResponse | null
  /** 各 device_type 的可用性探测结果（浮层内每个 type 一个状态点） */
  deviceStatusMap: Partial<Record<DeviceType, RecordingDeviceStatusResponse>>
  /** 是否有任何已配置 Key 的设备（控制 popover 入口可点击） */
  hasDeviceData: boolean
  /** 「我的设备」浮层开关与回调 */
  deviceListOpen: boolean
  handleDeviceListOpenChange: (open: boolean) => void
  /** 接入 / 编辑弹窗（editingDevice 为 null = 新增，否则 = 编辑） */
  editingDevice: RecordingDeviceConfig | null
  connectModalVisible: boolean
  connectForm: FormInstance<{ brand: RecordingDeviceConfig['device_type']; apiKey: string }>
  connectLoading: boolean
  openConnectModal: (mode: 'add' | 'edit', editingId?: string) => void
  closeConnectModal: () => void
  handleConnectConfirm: () => Promise<void>
  /** 手动同步（仅同步 active 设备） */
  syncing: boolean
  syncModalVisible: boolean
  setSyncModalVisible: (visible: boolean) => void
  handleOpenSyncModal: () => void
  handleConfirmSync: (params: { remote_ids?: string[]; exclude_remote_ids?: string[] }) => void
  /** 浮层操作 */
  handleEditDevice: (id: string) => void
  handleAddDevice: () => void
  handleSetActiveDevice: (id: string) => void
  handleRemoveDevice: (id: string) => void
}

/**
 * SonicNote 设备接入 / 激活 / 探测 / 手动同步（原 RecordingView 内联逻辑）。
 *
 * 后端契约：
 * - 每用户多设备配置（多 type + 多 key），is_active 标记当前同步目标
 * - 同步任务「每用户单 job」（GET /sync-status 无参、POST /sync 有防重入 code=4）
 *
 * 挂载时序：先问「同步状态」再问「设备列表」——
 * - 后端已在跑 → 接管轮询（避免重复触发 + 防重入弹错）
 * - 后端没在跑 → 拉设备 → 兜底激活 → 若有激活设备则探测可用性（不自动同步）
 */
export function useRecordingDevices({
  onSyncComplete,
}: UseRecordingDevicesOptions): UseRecordingDevicesReturn {
  // onSyncComplete 引用：finishSync 轮询回调要调最新的列表刷新（它依赖搜索/过滤条件会重建）
  const onSyncCompleteRef = useRef(onSyncComplete)
  useEffect(() => {
    onSyncCompleteRef.current = onSyncComplete
  }, [onSyncComplete])

  // ---- 接入 / 编辑弹窗 ----
  const [connectModalVisible, setConnectModalVisible] = useState(false)
  const [connectForm] = Form.useForm<{ brand: RecordingDeviceConfig['device_type']; apiKey: string }>()
  const [connectLoading, setConnectLoading] = useState(false)

  // ---- 设备列表 ----
  const [devices, setDevices] = useState<RecordingDeviceConfig[]>([])
  const activeDevice = useMemo(() => devices.find((d) => d.is_active) ?? null, [devices])
  const hasDeviceData = devices.some((d) => !!d.api_key)

  // ---- 同步任务状态 ----
  // 前端只追踪一个 job：
  // - syncJobRef 是唯一真相，'pending' = 已发起但还没拿到 job_id（用来挡住连点）。
  //   必须用 ref：轮询回调与 fireSync 入口都要"同步"读取，setState 异步会读到旧值。
  // - syncing 只用于渲染，永远经 setSyncJob 一起改，杜绝两份状态漂移。
  const syncJobRef = useRef<'pending' | string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const setSyncJob = useCallback((job: 'pending' | string | null) => {
    syncJobRef.current = job
    setSyncing(job !== null)
  }, [])
  const [syncModalVisible, setSyncModalVisible] = useState(false)

  // ---- 设备可用性探测 ----
  // 结果按 device_type 存放。必须是 map：浮层里每个 type 一个状态点，
  // 用单个对象会被并发探测中最后返回的那次覆盖，其余 type 永远停在灰点。
  // 探测失败时保留该 type 旧值，避免把"已知可用"的设备瞬间显示成不可用。
  const [deviceStatusMap, setDeviceStatusMap] = useState<
    Partial<Record<DeviceType, RecordingDeviceStatusResponse>>
  >({})
  // 探测序号按 type 分桶：同 type 的慢请求不覆盖快请求，不同 type 互不干扰
  const probeSeqRef = useRef<Partial<Record<DeviceType, number>>>({})
  const activeDeviceStatus = activeDevice
    ? deviceStatusMap[activeDevice.device_type as DeviceType] ?? null
    : null

  // ---- 「我的设备」浮层 ----
  const [deviceListOpen, setDeviceListOpen] = useState(false)
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null)
  const editingDevice = useMemo(
    () => (editingDeviceId ? devices.find((d) => d.id === editingDeviceId) ?? null : null),
    [editingDeviceId, devices],
  )

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
  // 手动同步必须等结果才能决定要不要继续，所以返回比 void 写 state 重要。
  const probeDevice = useCallback(
    async (deviceType: DeviceType): Promise<RecordingDeviceStatusResponse | null> => {
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
    },
    [],
  )

  // 仅允许在已有接入数据时打开 popover（关闭永远允许）。
  // 打开时探测所有已配置 Key 的 type，刷新各自状态点。
  const handleDeviceListOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        if (!hasDeviceData) return
        const types = new Set(
          devices.filter((d) => !!d.api_key).map((d) => d.device_type as DeviceType),
        )
        for (const type of types) void probeDevice(type)
      }
      setDeviceListOpen(open)
    },
    [hasDeviceData, devices, probeDevice],
  )

  // ---- 同步轮询 ----

  // 同步任务终态复位：所有终止路径只走这一处，杜绝「写 ref 不写 state / 反之」的漂移
  const finishSync = useCallback(
    (result: 'completed' | 'failed' | 'interrupted', status?: SyncStatusResponse) => {
      setSyncJob(null)
      stopSyncPollRef.current?.()
      if (result === 'completed' && status) {
        message.success(
          `同步完成，共发现 ${status.discovered} 条，新增 ${status.imported} 条，失败 ${status.failed} 条`,
        )
        onSyncCompleteRef.current?.()
      } else if (result === 'failed') {
        message.error(status?.error_message || '同步失败')
      } else {
        message.warning('上次同步被中断，请点击同步重新尝试')
      }
    },
    [setSyncJob],
  )

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
      return // 单次失败不打断，下一轮继续
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

  // 触发同步：调 POST /sync 拿 job_id 后启动轮询。仅由用户手动触发（同步按钮），
  // 失败时弹错。syncJobRef 既是入口互斥锁也是轮询追踪 id，
  // 'pending' 表示已发起但还没拿到 job_id（挡住连点）。
  const fireSync = useCallback(
    async (
      device: RecordingDeviceConfig,
      params?: { remote_ids?: string[]; exclude_remote_ids?: string[] },
    ) => {
      if (syncJobRef.current !== null) return
      setSyncJob('pending')
      try {
        const { job_id } = await recordingApi.syncDevice({
          device_type: device.device_type as DeviceType,
          device_id: device.id,
          remote_ids: params?.remote_ids,
          exclude_remote_ids: params?.exclude_remote_ids,
        })
        setSyncJob(job_id)
        startSyncPoll()
      } catch (e: any) {
        setSyncJob(null)
        const code = e?.code ?? e?.response?.data?.code
        if (code === 4) {
          message.warning('同步任务进行中，请稍后再试')
        } else {
          const msg = e?.response?.data?.message || e?.message || '同步失败'
          message.error(msg)
        }
      }
    },
    [setSyncJob, startSyncPoll],
  )

  // 手动同步：打开录音同步弹窗。只同步当前 active 设备。
  const handleOpenSyncModal = useCallback(() => {
    if (!activeDevice) {
      message.warning('请先接入设备')
      return
    }
    void probeDevice(activeDevice.device_type as DeviceType)
    if (activeDeviceStatus && !activeDeviceStatus.available) {
      message.warning(activeDeviceStatus.reason || '设备不可用，无法同步')
      return
    }
    setSyncModalVisible(true)
  }, [activeDevice, activeDeviceStatus, probeDevice])

  // 弹窗确认同步
  const handleConfirmSync = useCallback(
    (params: { remote_ids?: string[]; exclude_remote_ids?: string[] }) => {
      if (!activeDevice) return
      setSyncModalVisible(false)
      void fireSync(activeDevice, params)
    },
    [activeDevice, fireSync],
  )

  // 挂载时序：先问「同步状态」再问「设备列表」（见 hook 头注释）。
  // 状态接口失败视作「没活跃任务」继续往下；设备接口失败则保持空列表。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Step 1：状态接口必须先回来
      let status: SyncStatusResponse | null = null
      try {
        status = await recordingApi.getSyncStatus()
      } catch {
        // 网络失败：当作「无活跃任务」
      }
      if (cancelled) return

      if (status?.status === 'running') {
        setSyncJob(status.job_id)
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

      // Step 3：若有激活设备，主动探测一次设备可用性（保持状态点最新，不触发自动同步）
      const currentActive = loaded.find((d) => d.is_active && d.enabled)
      if (currentActive) {
        void probeDevice(currentActive.device_type as DeviceType)
      }
    })()
    return () => {
      cancelled = true
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: 仅挂载时执行一次的初始化时序
  }, [])

  // 打开接入弹窗：mode='add' 时初始化默认值；mode='edit' 时回填目标 device。
  // 把 editingDeviceId 设到 state 驱动 ConnectDeviceModal 的标题/字段 disabled。
  const openConnectModal = useCallback(
    (mode: 'add' | 'edit', editingId?: string) => {
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
  // 成功后 reload 设备列表 + 探测当前激活设备（不自动同步，同步需用户手动点击）。
  const handleConnectConfirm = useCallback(async () => {
    let values: { brand: RecordingDeviceConfig['device_type']; apiKey: string }
    try {
      values = await connectForm.validateFields()
    } catch {
      return
    }
    setConnectLoading(true)
    try {
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
      // 探测当前激活设备的可用性，更新状态点（手动同步模式，不自动触发同步）
      const currentActive = loaded.find((d) => d.is_active && d.enabled)
      if (currentActive) {
        void probeDevice(currentActive.device_type as DeviceType)
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || (editingDeviceId ? '更新失败' : '接入失败')
      message.error(msg)
    } finally {
      setConnectLoading(false)
    }
  }, [
    connectForm,
    editingDeviceId,
    devices,
    closeConnectModal,
    reloadDevices,
    probeDevice,
  ])

  // 「我的设备」浮层回调：
  // - 编辑：打开弹窗（编辑模式），回填 device_type
  // - 添加：打开弹窗（新增模式），brand 默认 SonicNote
  // - 设当前：调 setActiveDevice，切换 is_active 标记
  // - 移除：调 deleteDeviceById；若删的是 active 设备，自动激活剩余第一个 enabled
  const handleEditDevice = useCallback(
    (id: string) => {
      setDeviceListOpen(false)
      openConnectModal('edit', id)
    },
    [openConnectModal],
  )

  const handleAddDevice = useCallback(() => {
    setDeviceListOpen(false)
    openConnectModal('add')
  }, [openConnectModal])

  const handleSetActiveDevice = useCallback(
    (id: string) => {
      const target = devices.find((d) => d.id === id)
      if (!target) return
      if (activeDevice?.id === target.id) return
      // 切换激活设备属于破坏性操作（手动同步的目标随之改变），
      // 按 spec 在执行前弹确认。后端 setActiveDevice 幂等，无需前端防双击；
      // 用户连续切两次会触发两个 Modal，由用户决定取消哪个。
      Modal.confirm({
        title: '切换当前激活设备？',
        content: `切换后将使用「${target.api_key}」作为当前激活设备。`,
        okText: t('action.confirm'),
        cancelText: t('action.cancel'),
        onOk: async () => {
          try {
            await recordingApi.setActiveDevice(id)
            const list = await reloadDevices(devices)
            const newActive = list.find((d) => d.id === id)
            if (newActive) {
              void probeDevice(newActive.device_type as DeviceType)
            }
          } catch (e: any) {
            const msg = e?.response?.data?.message || e?.message || '切换激活设备失败'
            message.error(msg)
          }
        },
      })
    },
    [devices, activeDevice, reloadDevices, probeDevice],
  )

  const handleRemoveDevice = useCallback(
    (id: string) => {
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

  return {
    devices,
    activeDevice,
    activeDeviceStatus,
    deviceStatusMap,
    hasDeviceData,
    deviceListOpen,
    handleDeviceListOpenChange,
    editingDevice,
    connectModalVisible,
    connectForm,
    connectLoading,
    openConnectModal,
    closeConnectModal,
    handleConnectConfirm,
    syncing,
    syncModalVisible,
    setSyncModalVisible,
    handleOpenSyncModal,
    handleConfirmSync,
    handleEditDevice,
    handleAddDevice,
    handleSetActiveDevice,
    handleRemoveDevice,
  }
}
