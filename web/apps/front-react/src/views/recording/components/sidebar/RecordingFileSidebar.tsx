import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import { Button, Dropdown, Input, Popover, Tooltip, message } from 'antd'
import type { MenuProps } from 'antd'
import { LoadingOutlined, RedoOutlined, SearchOutlined } from '@ant-design/icons'
import { SvgIcon } from '@km/shared-components-react'
import { useEnv } from '@/hooks/useEnv'
import { usePoll } from '@/hooks/usePoll'
import { checkVersion } from '@/utils/version'
import { VERSION_MODULE } from '@/constants/enterprise'
import { useRecordingStore } from '@/stores/modules/recording'
import recordingApi from '@/api/modules/recording'
import { t } from '@/locales'
import { useIsRecordOnly } from '@/stores/modules/enterprise'
import { useMySpaceContext } from '@/views/mine/hooks/useMySpaceContext'
import { useAudioImport } from '@/views/mine/hooks/useAudioImport'
import { AUDIO_ACCEPT } from '@/views/mine/constants'
import { MAX_AUDIO_IMPORT_SIZE } from '../../constants/recordingLimits'
import { BRAND_OPTIONS } from '../../constants/brandOptions'
import { useRecordingDevices } from '../../hooks/useRecordingDevices'
import type { RecordingFileItemUI } from '../../hooks/useRecordingList'
import { RecordingFileList } from '../../components/list/RecordingFileList'
import { ResponsiveSidebar } from '@/components/Layout/ResponsiveSidebar'
import { ConnectDeviceModal } from '../../components/brand/ConnectDeviceModal'
import { DeviceListPopover } from '../../components/brand/DeviceListPopover'
import { DeviceSyncModal } from '../../components/brand/DeviceSyncModal'

export interface RecordingFileSidebarProps {
  // ---- 文件列表（数据与操作都在父布局：预览页要经 Outlet context 反向驱动同一份状态） ----
  fileList: RecordingFileItemUI[]
  loading: boolean
  hasMore: boolean
  onLoadMore: () => void
  /** 当前预览的文件 id（URL 派生），列表高亮用 */
  selectedId: string | null
  onSelect: (item: RecordingFileItemUI) => void
  /** 列表行更多菜单命令（new-tab / favorite / rename / delete） */
  onCommand: (item: RecordingFileItemUI, cmd: string) => void
  // ---- 搜索 / 分类 / 排序（状态在父布局：驱动 useRecordingList 取数） ----
  keyword: string
  onKeywordChange: (value: string) => void
  /** 分类标签：全部 + 服务端场景字典 */
  categoryTags: { key: string; label: string }[]
  activeCategoryTag: string
  onActiveCategoryTagChange: (key: string) => void
  sortOrder: 'updated_time' | 'created_time'
  onSortOrderChange: (value: 'updated_time' | 'created_time') => void
  // ---- 认知待确认徽标（轮询在父布局：侧栏隐藏时也要喂应用侧边栏红点） ----
  cognitionPendingCount: number
  /** 文件列表刷新（设备同步完成 / 导入成功后调用） */
  refresh: () => void
}

/**
 * 安心录左栏：录音设备、录音控制、导入、搜索、分类、文件列表。
 * 从 RecordingView 抽出——设备/同步/导入/排队轮询等仅服务左栏的逻辑全部内聚在此，
 * erhao.html 入口下非"经营"子路由不渲染本组件，相关请求与轮询也随之停止。
 */
export function RecordingFileSidebar({
  fileList,
  loading,
  hasMore,
  onLoadMore,
  selectedId,
  onSelect,
  onCommand,
  keyword,
  onKeywordChange,
  categoryTags,
  activeCategoryTag,
  onActiveCategoryTagChange,
  sortOrder,
  onSortOrderChange,
  cognitionPendingCount,
  refresh,
}: RecordingFileSidebarProps) {
  const navigate = useNavigate()
  const { isOpLocalEnv, isPrivatePremEnv } = useEnv()
  const { ensureLibraryId } = useMySpaceContext()
  const recordingConfig = useRecordingStore((s) => s.recordingConfig)
  const recordingStatus = useRecordingStore((s) => s.status)
  const isTransitioning = useRecordingStore((s) => s.isTransitioning)

  // 安心录模式（erhao.html 入口或企业配置）：子页面导航（经营/认知/记忆/关系/知识）在应用侧边栏，
  // 左栏不重复渲染“记忆/认知”入口
  const isRecordOnly = useIsRecordOnly()
  const memoryMatch = useMatch('/recording/memory')
  const cognitionMatch = useMatch('/recording/cognition')
  const relationsMatch = useMatch('/recording/relations')

  // 系统声音采集开关暂未开放（原 Checkbox 已下线），录音/恢复仍按 true 传参
  const [enableSystemAudio] = useState(true)

  const hasRecording = checkVersion(VERSION_MODULE.RECORDING)
  const hasActiveRecording = recordingStatus !== 'idle'
  const showRecordingButton =
    !isOpLocalEnv &&
    !isPrivatePremEnv &&
    hasRecording &&
    !!recordingConfig?.enabled

  // ---- SonicNote 设备 & 同步 ----
  const devices = useRecordingDevices({ onSyncComplete: refresh })

  // ---- 音频导入 ----
  const audioImport = useAudioImport({
    ensureLibraryId,
    currentPath: '/',
    onSuccess: () => {
      refresh()
    },
    maxSize: MAX_AUDIO_IMPORT_SIZE,
  })

  // ---- 音频解析排队任务数 ----
  // 5s 轮询一次；队列空（queued_count=0）时主动 stop，避免空闲时无意义请求。
  // 组件卸载由 usePoll 自动 stop。
  const [queuedCount, setQueuedCount] = useState(0)
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

  // 进入先取一次排队任务数，并启动轮询
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

  const handleStartRecording = () => {
    if (hasActiveRecording) {
      message.warning('正在运行录音，结束当前录音后可开启新的录音...')
      return
    }
    useRecordingStore.getState().start(true, enableSystemAudio)
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

  return (
    <>
      <ResponsiveSidebar className="pt-4 bg-white border-r border-[#EDEEF0]">
        {({ close }) => (
          <>
            <div className="h-10 flex items-center justify-between px-3">
              <Popover
                open={devices.deviceListOpen}
                onOpenChange={devices.handleDeviceListOpenChange}
                trigger="click"
                placement="bottomLeft"
                arrow={false}
                content={
                  <DeviceListPopover
                    devices={devices.devices}
                    deviceStatusMap={devices.deviceStatusMap}
                    onEdit={devices.handleEditDevice}
                    onSetActive={devices.handleSetActiveDevice}
                    onAdd={devices.handleAddDevice}
                    onRemove={devices.handleRemoveDevice}
                  />
                }
              >
                <div
                  className={[
                    'text-sm text-primary flex items-center gap-1.5',
                    // 已接入数据才允许点击浮层；未接入时关闭 cursor/hover 反馈
                    devices.hasDeviceData ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
                  ].join(' ')}
                >
                  <SvgIcon name="devices" />
                  {/* 已配置：显示 active 设备的品牌 label；未配置：保持"录音设备" */}
                  {devices.activeDevice
                    ? BRAND_OPTIONS.find((b) => b.value === devices.activeDevice?.device_type)?.label ??
                      '录音设备'
                    : '录音设备'}
                  {/* 已绑定 Key 且已探测完成 → 显示绿/红小点（按 active 设备的 type）。
                      红色时鼠标悬停查看 reason（key_invalid / 设备未启用 / network_error 等）。 */}
                  {devices.activeDevice?.api_key && devices.activeDeviceStatus && (
                    devices.activeDeviceStatus.available ? (
                      <span
                        className="inline-block size-2 rounded-full bg-green-500"
                        aria-label="设备可用"
                      />
                    ) : (
                      <Tooltip title={devices.activeDeviceStatus.reason || '设备不可用'} placement="top">
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
              {devices.devices.length === 0 ? (
                <div
                  className="flex items-center gap-1 text-sm text-[#6B7280] cursor-pointer hover:text-primary"
                  onClick={() => devices.openConnectModal('add')}
                >
                  <SvgIcon name="equalizer" className="rotate-90" />
                  接入
                </div>
              ) : (
                // 有设备：显示同步按钮（同步 active）；同步中或 active 设备探测不可用时禁用
                <Button
                  color="primary"
                  variant="link"
                  onClick={devices.handleOpenSyncModal}
                  disabled={devices.syncing || !!(devices.activeDeviceStatus && !devices.activeDeviceStatus.available)}
                  className="px-0"
                  icon={devices.syncing ? <LoadingOutlined spin /> : <RedoOutlined />}
                >
                  {devices.syncing ? '同步中' : '同步'}
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
                      onClick={() =>
                        useRecordingStore.getState().recoverInterrupted(true, enableSystemAudio)
                      }
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
                  {showRecordingButton && (
                    <Button
                      type="primary"
                      icon={<SvgIcon name="voice-one" size={18} />}
                      onClick={handleStartRecording}
                    >
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

            {/* erhao.html 入口下子页面导航由应用侧边栏承担，左栏不重复渲染入口 */}
            {!isRecordOnly && (
              <div className="px-3 mt-3">
                <button
                  type="button"
                  onClick={() => {
                    navigate('/recording/memory')
                    close()
                  }}
                  className={[
                    'w-full h-9 flex items-center gap-2 px-3 rounded-lg text-left text-[13px] transition-colors',
                    memoryMatch
                      ? 'bg-[#E0EAFF] text-[#2563EB]'
                      : 'text-[#334155] hover:bg-[#EEF4FF] hover:text-[#2563EB]',
                  ].join(' ')}
                >
                  <SvgIcon name="memory" size={16} />
                  <span>记忆</span>
                </button>
              </div>
            )}

            {!isRecordOnly && (
              <div className="px-3 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    navigate('/recording/cognition')
                    close()
                  }}
                  className={[
                    'w-full h-9 flex items-center gap-2 px-3 rounded-lg text-left text-[13px] transition-colors',
                    cognitionMatch
                      ? 'bg-[#E0EAFF] text-[#2563EB]'
                      : 'text-[#334155] hover:bg-[#EEF4FF] hover:text-[#2563EB]',
                  ].join(' ')}
                >
                  <SvgIcon name="cognition" size={16} />
                  <span>认知</span>
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
            )}

            {!isRecordOnly && (
              <div className="px-3 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    navigate('/recording/relations')
                    close()
                  }}
                  className={[
                    'w-full h-9 flex items-center gap-2 px-3 rounded-lg text-left text-[13px] transition-colors',
                    relationsMatch
                      ? 'bg-[#E0EAFF] text-[#2563EB]'
                      : 'text-[#334155] hover:bg-[#EEF4FF] hover:text-[#2563EB]',
                  ].join(' ')}
                >
                  <SvgIcon name="relation" size={16} />
                  <span>关系</span>
                </button>
              </div>
            )}

            <div className="px-3 mt-2 pb-2">
              <Input
                allowClear
                value={keyword}
                onChange={(e) => onKeywordChange(e.target.value)}
                placeholder="搜索"
                prefix={<SearchOutlined />}
              />
            </div>

            <div className="px-3 pb-2">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[13px] text-secondary">领域</div>
                <div className="flex items-center gap-1">
                  <Dropdown
                    menu={{
                      items: sortMenuItems,
                      onClick: ({ key }) => onSortOrderChange(key as 'updated_time' | 'created_time'),
                    }}
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
                      onClick={() => onActiveCategoryTagChange(tag.key)}
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
              selectedId={selectedId}
              onSelect={(item) => {
                onSelect(item)
                close()
              }}
              onCommand={onCommand}
              hasMore={hasMore}
              onLoadMore={onLoadMore}
              categoryTags={categoryTags}
            />
          </>
        )}
      </ResponsiveSidebar>

      {/* 隐藏 file input for audio import */}
      <input
        type="file"
        ref={audioImport.fileInputRef as RefObject<HTMLInputElement>}
        accept={AUDIO_ACCEPT}
        multiple
        onChange={audioImport.handleFileChange}
        style={{ display: 'none' }}
      />

      {/* 接入 / 编辑设备弹窗（双模式：editingDevice 为 null = 新增，否则 = 编辑） */}
      <ConnectDeviceModal
        open={devices.connectModalVisible}
        loading={devices.connectLoading}
        connectForm={devices.connectForm}
        editingDevice={devices.editingDevice}
        onOk={devices.handleConnectConfirm}
        onCancel={devices.closeConnectModal}
      />

      {/* 录音设备手动同步弹窗 */}
      <DeviceSyncModal
        open={devices.syncModalVisible}
        activeDevice={devices.activeDevice}
        syncing={devices.syncing}
        onSync={devices.handleConfirmSync}
        onCancel={() => devices.setSyncModalVisible(false)}
      />
    </>
  )
}

export default RecordingFileSidebar
