import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import recordingApi from '@/api/modules/recording'
import { DeviceSyncModal, type DeviceRecordingItem } from './DeviceSyncModal'

// DeviceSyncModal 内部通过 recordingApi.getDeviceRecordings 拉取远端列表，mock 掉避免真实请求
vi.mock('@/api/modules/recording', () => ({
  default: { getDeviceRecordings: vi.fn() },
}))

const TEST_RECORDINGS: DeviceRecordingItem[] = [
  { remote_id: '1', title: '全端架构实现方案讨论会.m4a', date: '2026-07-30 14:01', sync_status: 'not_synced' },
  { remote_id: '2', title: 'APP 新增录音功能需求评审会.m4a', date: '2026-07-30 14:01', sync_status: 'not_synced' },
  { remote_id: '3', title: '智谱高层项目研讨闭门会.mp3', date: '2026-07-30 14:01', sync_status: 'not_synced' },
  { remote_id: '4', title: '二号总裁新增录音功能需求评审会.m4a', date: '2026-07-30 14:01', sync_status: 'not_synced' },
  { remote_id: '5', title: '版本 V2.3 上线前预演复盘会.mp3', date: '2026-07-30 14:01', sync_status: 'not_synced' },
  { remote_id: '6', title: '会议_20260520_020855.m4a', date: '2026-07-30 14:01', sync_status: 'not_synced' },
  { remote_id: '7', title: '数据库索引优化与慢查询治理会议.m4a', date: '2026-07-30 14:01', sync_status: 'not_synced' },
]

describe('DeviceSyncModal', () => {
  it('正确渲染统计卡片与标题文案', () => {
    render(
      <DeviceSyncModal
        open={true}
        initialSummary={{ total: 41, synced: 33, unsynced: 8 }}
        initialRecordings={TEST_RECORDINGS}
        onSync={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText('录音同步')).toBeInTheDocument()
    expect(
      screen.getByText('录音设备共 41 条录音记录，已经同步 33 条，未同步 8 条'),
    ).toBeInTheDocument()
    expect(screen.getByText('41')).toBeInTheDocument()
    expect(screen.getByText('设备录音')).toBeInTheDocument()
    expect(screen.getByText('33')).toBeInTheDocument()
    expect(screen.getByText('已同步')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('待同步')).toBeInTheDocument()
    expect(screen.getByText('已同步的33条录音不会重复导入')).toBeInTheDocument()
  })

  it('初始展示4条录音与“还有 3 条录音”展开入口，点击展开全部', () => {
    render(
      <DeviceSyncModal
        open={true}
        initialRecordings={TEST_RECORDINGS}
        onSync={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    // 初始前 4 条存在
    expect(screen.getByText('全端架构实现方案讨论会.m4a')).toBeInTheDocument()
    expect(screen.getByText('APP 新增录音功能需求评审会.m4a')).toBeInTheDocument()
    expect(screen.getByText('智谱高层项目研讨闭门会.mp3')).toBeInTheDocument()
    expect(screen.getByText('二号总裁新增录音功能需求评审会.m4a')).toBeInTheDocument()

    // 展开入口：7 - 4 = 还有 3 条录音
    const expandBtn = screen.getByText('还有 3 条录音')
    expect(expandBtn).toBeInTheDocument()

    // 点击展开
    fireEvent.click(expandBtn)

    // 展开后全部可见，展开入口消失
    expect(screen.getByText('版本 V2.3 上线前预演复盘会.mp3')).toBeInTheDocument()
    expect(screen.getByText('会议_20260520_020855.m4a')).toBeInTheDocument()
    expect(screen.getByText('数据库索引优化与慢查询治理会议.m4a')).toBeInTheDocument()
    expect(screen.queryByText('还有 3 条录音')).not.toBeInTheDocument()
  })

  it('全选时点击同步不传 remote_ids 与 exclude_remote_ids（全量同步）', () => {
    const handleSync = vi.fn()

    render(
      <DeviceSyncModal
        open={true}
        initialRecordings={TEST_RECORDINGS}
        onSync={handleSync}
        onCancel={vi.fn()}
      />,
    )

    // 默认全选
    expect(screen.getByText('已全部选中')).toBeInTheDocument()

    const syncBtn = screen.getByRole('button', { name: '同 步' })
    fireEvent.click(syncBtn)

    // 全选时不传 remote_ids 和 exclude_remote_ids
    expect(handleSync).toHaveBeenCalledWith({})
  })

  it('只有某个不同步时传 exclude_remote_ids', () => {
    const handleSync = vi.fn()

    render(
      <DeviceSyncModal
        open={true}
        initialRecordings={TEST_RECORDINGS}
        onSync={handleSync}
        onCancel={vi.fn()}
      />,
    )

    // 取消勾选第 1 项（全端架构实现方案讨论会.m4a）
    fireEvent.click(screen.getByText('全端架构实现方案讨论会.m4a'))

    const syncBtn = screen.getByRole('button', { name: '同 步' })
    fireEvent.click(syncBtn)

    // 传 exclude_remote_ids
    expect(handleSync).toHaveBeenCalledWith({ exclude_remote_ids: ['1'] })
  })

  it('只传某几个时传 remote_ids', () => {
    const handleSync = vi.fn()

    render(
      <DeviceSyncModal
        open={true}
        initialRecordings={TEST_RECORDINGS}
        onSync={handleSync}
        onCancel={vi.fn()}
      />,
    )

    // 先取消全选
    fireEvent.click(screen.getByText('已全部选中'))

    // 只勾选第 2 项（APP 新增录音功能需求评审会.m4a）
    fireEvent.click(screen.getByText('APP 新增录音功能需求评审会.m4a'))

    const syncBtn = screen.getByRole('button', { name: '同 步' })
    fireEvent.click(syncBtn)

    // 传 remote_ids
    expect(handleSync).toHaveBeenCalledWith({ remote_ids: ['2'] })
  })

  it('全部已同步时（待同步为0），展示空状态且同步按钮禁用', () => {
    render(
      <DeviceSyncModal
        open={true}
        initialSummary={{ total: 41, synced: 41, unsynced: 0 }}
        initialRecordings={[]}
        onSync={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    // 统计展示
    expect(screen.getByText('录音设备共 41 条录音记录，已经同步 41 条，未同步 0 条')).toBeInTheDocument()
    expect(screen.getByText('设备录音已全部同步')).toBeInTheDocument()
    expect(screen.getByText('待同步录音（0）')).toBeInTheDocument()

    // 同步按钮禁用
    const syncBtn = screen.getByRole('button', { name: '同 步' })
    expect(syncBtn).toBeDisabled()
  })
})

const AUDIO_TIP =
  '该录音未获取到音频链接，同步时将尝试从详情获取，若仍无法获取将同步失败'

const AUDIO_TIP_RECORDINGS: DeviceRecordingItem[] = [
  { remote_id: '1', title: '有音频链接的录音.m4a', date: '2026-07-30 14:01', sync_status: 'not_synced', audio_available: true },
  { remote_id: '2', title: '无音频链接的录音.m4a', date: '2026-07-30 14:01', sync_status: 'not_synced', audio_available: false },
  { remote_id: '3', title: '未返回该字段的录音.m4a', date: '2026-07-30 14:01', sync_status: 'not_synced' },
]

// antd Modal 内容渲染在 portal（挂到 document.body），需从 body 查询
const queryWarningIcons = () =>
  document.body.querySelectorAll('use[href="#icon-warning"]')

describe('DeviceSyncModal audio_available 提示（仅 SonicNote）', () => {
  it('SonicNote 且 audio_available === false 的条目展示警告图标，其余不展示', () => {
    render(
      <DeviceSyncModal
        open={true}
        deviceType="sonicnote"
        initialRecordings={AUDIO_TIP_RECORDINGS}
        onSync={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    // 仅 remote_id=2（audio_available=false）展示警告图标
    expect(queryWarningIcons()).toHaveLength(1)
  })

  it('hover 警告图标展示提示文案', async () => {
    render(
      <DeviceSyncModal
        open={true}
        deviceType="sonicnote"
        initialRecordings={AUDIO_TIP_RECORDINGS}
        onSync={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const warningSvg = queryWarningIcons()[0]?.closest('svg')
    expect(warningSvg).toBeTruthy()
    fireEvent.mouseEnter(warningSvg!)

    expect(await screen.findByText(AUDIO_TIP)).toBeInTheDocument()
  })

  it('非 SonicNote 设备忽略 audio_available 字段，不展示警告图标', () => {
    render(
      <DeviceSyncModal
        open={true}
        deviceType="ticnote"
        initialRecordings={AUDIO_TIP_RECORDINGS}
        onSync={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(queryWarningIcons()).toHaveLength(0)
  })

  it('activeDevice 路径：接口返回后按设备类型渲染提示（deviceType 缺省取 activeDevice.device_type）', async () => {
    const getDeviceRecordingsMock = vi.mocked(recordingApi.getDeviceRecordings)
    getDeviceRecordingsMock.mockResolvedValue({
      device_type: 'sonicnote',
      configured: true,
      enabled: true,
      device_id: 'd1',
      sync_status: 'unsynced',
      page: 1,
      size: 4,
      total: 3,
      has_more: false,
      summary: { total: 3, synced: 0, file_deleted: 0, not_synced: 3, unsynced: 3 },
      items: AUDIO_TIP_RECORDINGS,
    })

    render(
      <DeviceSyncModal
        open={true}
        activeDevice={{ id: 'd1', device_type: 'sonicnote', api_key: 'sk-xxxx', enabled: true }}
        onSync={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(getDeviceRecordingsMock).toHaveBeenCalled()
      expect(queryWarningIcons()).toHaveLength(1)
    })
  })
})
