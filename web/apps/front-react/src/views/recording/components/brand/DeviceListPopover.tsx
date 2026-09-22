import { Tooltip } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import type { RecordingDeviceConfig, RecordingDeviceStatusResponse } from '@/api/modules/recording/types'
import { BRAND_OPTIONS, type BrandCardOption, type DeviceType } from '../../constants/brandOptions'

interface DeviceListPopoverProps {
  /** 全部已配置设备（含多 key + 多 type） */
  devices: RecordingDeviceConfig[]
  /**
   * 设备可用性探测结果（按 device_type 分桶）。
   * 由调用方在打开 popover 时探测；缺失的 key 表示该 type 尚未探测或探测失败。
   * 用 map 而非单对象：多 type 并发探测时各 type 互不覆盖。
   */
  deviceStatusMap: Partial<Record<DeviceType, RecordingDeviceStatusResponse>>
  /** 编辑指定 id 的设备（弹窗由调用方控制） */
  onEdit: (id: string) => void
  /** 设置指定 id 为当前激活设备 */
  onSetActive: (id: string) => void
  /** 添加新设备（弹窗由调用方控制） */
  onAdd: () => void
  /** 删除指定 id 的设备 */
  onRemove: (id: string) => void
}

/**
 * 「我的设备」浮层内容。
 *
 * 按 device_type 分组展示已配置设备。每行右侧：
 * - 设当前（仅非 active 行显示；点击 → onSetActive）
 * - 编辑（点击 → onEdit 打开弹窗）
 * - 删除（点击 → onRemove 二次确认）
 *
 * 当前激活设备整行加 #F2F6FE 背景，状态点（绿/红）按 type-level 探测共享。
 *
 * 底部固定"+ 添加"入口，用于添加新设备。
 */
export function DeviceListPopover({
  devices,
  deviceStatusMap,
  onEdit,
  onSetActive,
  onAdd,
  onRemove,
}: DeviceListPopoverProps) {
  // 渲染顺序：按 BRAND_OPTIONS 的固定顺序分组（先 SonicNote 再 TicNote 等），
  // 即使某个 type 当前没设备也保留 type 标题占位？—— 不，没设备就不渲染该 type。
  const groupedOptions = BRAND_OPTIONS
    .filter((opt) => opt.enabled && devices.some((d) => d.device_type === opt.value))

  return (
    <div className="w-[320px] -m-3 pb-1">
      <div className="px-3 py-2 text-sm text-secondary">我的设备</div>

      {groupedOptions.length === 0 && (
        <div className="px-3 py-4 text-sm text-secondary text-center">暂无设备</div>
      )}

      {groupedOptions.map((opt) => {
        const typeDevices = devices.filter((d) => d.device_type === opt.value)
        return (
          <div key={opt.value} className="px-1">
            {typeDevices.map((d) => {
              const isActive = !!d.is_active
              return (
                <DeviceRow
                  key={d.id ?? `${d.device_type}-${d.api_key}`}
                  brandLabel={opt.label}
                  status={deviceStatusMap[d.device_type as DeviceType] ?? null}
                  isActive={isActive}
                  onEdit={() => d.id && onEdit(d.id)}
                  onSetActive={() => d.id && onSetActive(d.id)}
                  onRemove={() => d.id && onRemove(d.id)}
                />
              )
            })}
          </div>
        )
      })}

      <div className="border-t border-[#EDEEF0] mx-1 mt-1">
        <div
          className="flex items-center gap-1 px-3 h-9 text-sm text-[#2563EB] cursor-pointer hover:bg-[#F5F6F7]"
          onClick={onAdd}
        >
          <SvgIcon name="plus" size={14} />
          <span>添加</span>
        </div>
      </div>
    </div>
  )
}

interface DeviceRowProps {
  brandLabel: string
  status: RecordingDeviceStatusResponse | null
  isActive: boolean
  onEdit: () => void
  onSetActive: () => void
  onRemove: () => void
}

function DeviceRow({ brandLabel, status, isActive, onEdit, onSetActive, onRemove }: DeviceRowProps) {
  return (
    <div
      className={[
        'flex items-center gap-2 px-3 h-9 transition-colors rounded',
        isActive ? 'bg-[#F2F6FE] text-theme' : 'hover:bg-[#F2F6FE] text-primary',
      ].join(' ')}
      onClick={onSetActive}
    >
      <div className="size-4 flex-center">
        <SvgIcon name="devices" />
      </div>
      <span className="text-sm leading-none">{brandLabel}</span>
      <StatusDot status={status} />
      <div className="ml-auto flex items-center gap-3 text-secondary">

        <SvgIcon
          name="equalizer"
          size={14}
          className="rotate-90 cursor-pointer hover:text-primary"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
        />
        <SvgIcon
          name="delete"
          size={14}
          className="cursor-pointer hover:text-red-500"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        />
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: RecordingDeviceStatusResponse | null }) {
  if (!status) {
    // 尚未探测完成：灰色占位，避免视觉跳动
    return (
      <span
        className="inline-block size-2 rounded-full bg-gray-300"
        aria-label="设备状态未知"
      />
    )
  }
  if (status.available) {
    return (
      <span
        className="inline-block size-2 rounded-full bg-green-500"
        aria-label="设备可用"
      />
    )
  }
  return (
    <Tooltip title={status.reason || '设备不可用'} placement="top">
      <span
        className="inline-block size-2 rounded-full bg-red-500 cursor-pointer"
        aria-label="设备不可用"
      />
    </Tooltip>
  )
}

// 显式 re-export 工具类型，方便调用方 import
export type { BrandCardOption }
