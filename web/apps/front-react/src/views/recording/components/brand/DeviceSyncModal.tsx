import { useState, useMemo, useEffect } from 'react'
import { Modal, Button, Spin, Empty, Tooltip } from 'antd'
import { InfoCircleOutlined, DownOutlined, LoadingOutlined } from '@ant-design/icons'
import { SvgIcon, SafeImage } from '@km/shared-components-react';
import { getSimpleDateFormatString } from '@km/shared-utils'
import { getPublicPath } from '@/utils/config'
import recordingApi from '@/api/modules/recording'
import type {
  RecordingDeviceConfig,
  RecordingDeviceType,
  RemoteRecordingItem,
} from '@/api/modules/recording/types'

export type { RemoteRecordingItem as DeviceRecordingItem }

export type DeviceSyncModalProps = {
  open: boolean
  activeDevice?: RecordingDeviceConfig | null
  /** 设备类型：决定是否展示 audio_available 提示（仅 sonicnote）；缺省取 activeDevice.device_type */
  deviceType?: RecordingDeviceType
  syncing?: boolean
  initialSummary?: {
    total?: number
    synced?: number
    unsynced?: number
  }
  initialRecordings?: RemoteRecordingItem[]
  onSync: (params: { remote_ids?: string[]; exclude_remote_ids?: string[] }) => void
  onCancel: () => void
}

const formatItemTime = (item: RemoteRecordingItem): string => {
  if (item.date) return item.date
  if (item.created_time) {
    const ms = item.created_time > 1e11 ? item.created_time : item.created_time * 1000
    return getSimpleDateFormatString({ date: new Date(ms), format: 'YYYY-MM-DD hh:mm' })
  }
  return ''
}

/**
 * SonicNote 列表未带音频 URL 的提示文案
 * （audio_available=false 仅代表列表层无 URL，detail 可能才有，不代表一定不可同步）
 */
const AUDIO_UNAVAILABLE_TIP =
  '该录音未获取到音频链接，同步时将尝试从详情获取，若仍无法获取将同步失败'

/**
 * 录音设备手动同步弹窗
 * - 首次打开重置状态并请求前 4 条待同步录音与 summary
 * - 点击「还有 xx 条录音」请求 full=true 获取全量未同步录音
 * - 支持全选（不传 remote_ids/exclude_remote_ids）、排除某几个（传 exclude_remote_ids）、指定某几个（传 remote_ids）
 */
export function DeviceSyncModal({
  open,
  activeDevice,
  deviceType,
  syncing = false,
  initialSummary,
  initialRecordings,
  onSync,
  onCancel,
}: DeviceSyncModalProps) {
  // audio_available 仅对 SonicNote 有意义（TicNote 恒为 false），其他设备类型忽略该字段
  const isSonicNote = (deviceType ?? activeDevice?.device_type) === 'sonicnote'

  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  // 统计数值（默认重置为 0）
  const [summary, setSummary] = useState({
    total: initialSummary?.total ?? 0,
    synced: initialSummary?.synced ?? 0,
    unsynced: initialSummary?.unsynced ?? 0,
  })

  // 待同步录音列表（默认空数组）
  const [items, setItems] = useState<RemoteRecordingItem[]>(
    () => initialRecordings ?? [],
  )

  // 选中状态：selectedIds 记录选中的 remote_id，unselectedIds 记录取消勾选的 remote_id
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialRecordings ? initialRecordings.map((r) => r.remote_id) : []),
  )
  const [unselectedIds, setUnselectedIds] = useState<Set<string>>(new Set())
  const [isAllSelected, setIsAllSelected] = useState(true)

  // 弹窗打开时重置并加载真实设备数据
  useEffect(() => {
    if (!open) return

    if (!activeDevice) {
      if (initialRecordings || initialSummary) {
        const list = initialRecordings ?? []
        setItems(list)
        setSelectedIds(new Set(list.map((r) => r.remote_id)))
        setUnselectedIds(new Set())
        setIsAllSelected(true)
        setIsExpanded(false)
        setSummary({
          total: initialSummary?.total ?? list.length,
          synced: initialSummary?.synced ?? 0,
          unsynced: initialSummary?.unsynced ?? list.length,
        })
      } else {
        setItems([])
        setSelectedIds(new Set())
        setUnselectedIds(new Set())
        setSummary({ total: 0, synced: 0, unsynced: 0 })
      }
      return
    }

    let cancelled = false
    setLoading(true)
    setIsExpanded(false)
    setItems([])
    setSelectedIds(new Set())
    setUnselectedIds(new Set())
    setIsAllSelected(true)
    setSummary({ total: 0, synced: 0, unsynced: 0 })

    recordingApi
      .getDeviceRecordings(activeDevice.device_type, {
        device_id: activeDevice.id,
        sync_status: 'unsynced',
        page: 1,
        size: 4,
      })
      .then((res) => {
        if (cancelled) return
        const newItems = res.items || []
        setItems(newItems)
        setSelectedIds(new Set(newItems.map((it) => it.remote_id)))
        if (res.summary) {
          setSummary({
            total: res.summary.total,
            synced: res.summary.synced,
            unsynced: res.summary.unsynced,
          })
        }
      })
      .catch(() => {
        // 请求失败
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, activeDevice, initialRecordings, initialSummary])

  // 点击「还有 xx 条录音」请求全量未同步数据
  const handleLoadMore = async () => {
    if (!activeDevice) {
      setIsExpanded(true)
      return
    }
    if (loadingMore) return

    setLoadingMore(true)
    try {
      const res = await recordingApi.getDeviceRecordings(activeDevice.device_type, {
        device_id: activeDevice.id,
        sync_status: 'unsynced',
        full: true,
      })
      const fullItems = res.items || []
      setItems(fullItems)
      setIsExpanded(true)
      if (res.summary) {
        setSummary({
          total: res.summary.total,
          synced: res.summary.synced,
          unsynced: res.summary.unsynced,
        })
      }
      // 全选状态下，补齐新条目选中（排除已明确取消勾选的）
      if (isAllSelected) {
        setSelectedIds(
          new Set(
            fullItems
              .filter((it) => !unselectedIds.has(it.remote_id))
              .map((it) => it.remote_id),
          ),
        )
      }
    } catch {
      // ignore
    } finally {
      setLoadingMore(false)
    }
  }

  // 还有多少条未展示
  const remainingCount = activeDevice
    ? Math.max(0, summary.unsynced - items.length)
    : Math.max(0, items.length - 4)

  // 全选 / 取消全选切换
  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set())
      setUnselectedIds(new Set(items.map((it) => it.remote_id)))
      setIsAllSelected(false)
    } else {
      setSelectedIds(new Set(items.map((it) => it.remote_id)))
      setUnselectedIds(new Set())
      setIsAllSelected(true)
    }
  }

  // 单条勾选切换
  const toggleItem = (remoteId: string) => {
    if (selectedIds.has(remoteId)) {
      const nextSelected = new Set(selectedIds)
      nextSelected.delete(remoteId)
      setSelectedIds(nextSelected)

      const nextUnselected = new Set(unselectedIds)
      nextUnselected.add(remoteId)
      setUnselectedIds(nextUnselected)
      setIsAllSelected(false)
    } else {
      const nextSelected = new Set(selectedIds)
      nextSelected.add(remoteId)
      setSelectedIds(nextSelected)

      const nextUnselected = new Set(unselectedIds)
      nextUnselected.delete(remoteId)
      setUnselectedIds(nextUnselected)

      if (nextUnselected.size === 0 && nextSelected.size === items.length) {
        setIsAllSelected(true)
      }
    }
  }

  // 确认同步
  const handleConfirm = () => {
    let params: { remote_ids?: string[]; exclude_remote_ids?: string[] } = {}

    if (isAllSelected && unselectedIds.size === 0) {
      // 全选：remote_ids 和 exclude_remote_ids 都不传，全量同步
      params = {}
    } else if (selectedIds.size <= unselectedIds.size) {
      // 只传某几个：传 remote_ids
      params = { remote_ids: Array.from(selectedIds) }
    } else {
      // 只有某个/某几个不同步：传 exclude_remote_ids
      params = { exclude_remote_ids: Array.from(unselectedIds) }
    }

    onSync(params)
  }

  // 展示列表
  const displayedRecordings = useMemo(() => {
    if (isExpanded || items.length <= 4) {
      return items
    }
    return items.slice(0, 4)
  }, [isExpanded, items])

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      width={800}
      destroyOnHidden
      title="录音同步"
      footer={
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-1.5 text-xs text-[#86909C]">
            <InfoCircleOutlined className="text-xs text-[#86909C]" />
            <span>
              {loading
                ? '正在查询已同步记录...'
                : `已同步的${summary.synced}条录音不会重复导入`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={onCancel}>取消</Button>
            <Button
              type="primary"
              onClick={handleConfirm}
              loading={syncing}
              disabled={loading || selectedIds.size === 0}
            >
              同步
            </Button>
          </div>
        </div>
      }
    >
      <div className="text-xs text-[#6B7280] -mt-2">
        {loading
          ? '正在获取设备录音信息...'
          : `录音设备共 ${summary.total} 条录音记录，已经同步 ${summary.synced} 条，未同步 ${summary.unsynced} 条`}
      </div>

      {/* 顶部三卡片总览 */}
      <div className="grid grid-cols-3 gap-3 mt-4">
        <div className="bg-[#F7F8FA] rounded-xl py-4 px-3 text-center">
          <div className="text-2xl font-bold text-[#1D1E1F]">
            {loading ? <Spin size="small" /> : summary.total}
          </div>
          <div className="text-xs text-[#6B7280] mt-1">设备录音</div>
        </div>
        <div className="bg-[#F7F8FA] rounded-xl py-4 px-3 text-center">
          <div className="text-2xl font-bold text-[#1D1E1F]">
            {loading ? <Spin size="small" /> : summary.synced}
          </div>
          <div className="text-xs text-[#6B7280] mt-1">已同步</div>
        </div>
        <div className="bg-[#F7F8FA] rounded-xl py-4 px-3 text-center">
          <div className="text-2xl font-bold text-[#1D1E1F]">
            {loading ? <Spin size="small" /> : summary.unsynced}
          </div>
          <div className="text-xs text-[#6B7280] mt-1">待同步</div>
        </div>
      </div>
        
      <div className="h-[1px] bg-[#E9EBF2] my-5" />
      {/* 待同步录音清单 */}
      <div className="flex items-center justify-between mb-2">
        <div
          className={`flex items-center gap-2 select-none ${items.length > 0 ? 'cursor-pointer' : 'cursor-default'}`}
          onClick={items.length > 0 ? toggleSelectAll : undefined}
        >
          {items.length > 0 && (
            isAllSelected ? (
              <SvgIcon name="check-one-filled" size={20} className="text-[#2563EB] flex-shrink-0" />
            ) : (
              <SvgIcon name="check-round" size={20} className="text-[#C9CDD4] flex-shrink-0 hover:text-[#2563EB]" />
            )
          )}
          <span className="font-semibold text-sm text-[#1D2129]">
            待同步录音（{loading ? '-' : summary.unsynced}）
          </span>
        </div>
        {items.length > 0 && (
          <div
            className="text-xs text-[#86909C] cursor-pointer select-none hover:text-[#2563EB]"
            onClick={toggleSelectAll}
          >
            {isAllSelected ? '已全部选中' : '全部选中'}
          </div>
        )}
      </div>

      {/* 录音项列表 */}
      <div className="max-h-[360px] overflow-y-auto pr-1">
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <Spin />
          </div>
        ) : displayedRecordings.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="设备录音已全部同步"
            className="my-8"
          />
        ) : (
          displayedRecordings.map((item) => {
            const isSelected = selectedIds.has(item.remote_id)
            const timeStr = formatItemTime(item)
            return (
              <div
                key={item.remote_id}
                className="flex items-center gap-3 py-4 border-b border-[#F2F3F5] last:border-none cursor-pointer hover:bg-gray-50/60 px-1 transition-colors"
                onClick={() => toggleItem(item.remote_id)}
              >
                {isSelected ? (
                  <SvgIcon name="check-one-filled" size={20} className="text-[#2563EB] flex-shrink-0" />
                ) : (
                  <SvgIcon name="check-round" size={20} className="text-[#C9CDD4] flex-shrink-0 hover:text-[#2563EB]" />
                )}

                {/* 音频图标 */}
                <SafeImage
                  src={'/images/file/mp3.png'}
                  alt="mp3"
                  className="size-8 object-contain flex-shrink-0"
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <div className="text-base font-medium text-[#1D1E1F] truncate" title={item.title}>
                      {item.title}
                    </div>
                    {isSonicNote && item.audio_available === false && (
                      <Tooltip title={AUDIO_UNAVAILABLE_TIP}>
                        <span>
                          <SvgIcon
                            name="warning"
                            size={14}
                            className="text-[var(--warning-color)] flex-shrink-0 cursor-pointer"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </span>
                      </Tooltip>
                    )}
                  </div>
                  {timeStr && (
                    <div className="text-sm text-[#9CA3AF] mt-0.5">
                      {timeStr}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}

        {!isExpanded && remainingCount > 0 && !loading && (
          <div
            className="flex items-center justify-center gap-1 py-3 text-xs text-[#86909C] cursor-pointer hover:text-[#2563EB] transition-colors select-none"
            onClick={handleLoadMore}
          >
            {loadingMore ? (
              <>
                <LoadingOutlined className="text-[10px]" />
                <span>正在加载...</span>
              </>
            ) : (
              <>
                <span>还有 {remainingCount} 条录音</span>
                <DownOutlined className="text-[10px]" />
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
