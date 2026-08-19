import { Tooltip } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import type { RecordingDeviceConfig, RecordingDeviceStatusResponse } from '@/api/modules/recording/types'
import type { BrandCardOption } from '../../constants/brandOptions'

interface DeviceListPopoverProps {
  /** 品牌候选列表 */
  options: BrandCardOption[]
  /** 当前已配置的设备（可能为 null） */
  device: RecordingDeviceConfig | null
  /** 当前已配置设备的可用性探测结果（仅对配置的设备类型有意义） */
  deviceStatus: RecordingDeviceStatusResponse | null
  onEdit: () => void
  onAdd: () => void
  onRemove: () => void
}

/**
 * 「我的设备」浮层内容。
 *
 * 只展示用户已配置的设备（按 device.device_type 过滤 BRAND_OPTIONS）。
 * 当前数据模型只支持单设备，所以过滤后通常只有一行；
 * 保留多选结构以便未来支持多设备时直接复用。
 *
 * 已配置行右侧展示 编辑/删除 按钮和真实探测结果的红/绿小点。
 * 底部展示「+ 添加」入口，用于重新配置或添加其他设备。
 *
 * 删除走 PUT /devices 将 enabled 置为 false（无独立 delete 接口）；
 * 这与现有"未启用即视为未配置"的语义保持一致。
 */
export function DeviceListPopover({ options, device, deviceStatus, onEdit, onAdd, onRemove }: DeviceListPopoverProps) {
  return (
    <div className="w-[280px] -m-3">
      <div className="px-3 py-2 text-[13px] text-secondary ">
        我的设备
      </div>
      <div className="px-1">
        {options.filter((opt) => device?.device_type === opt.value).map((opt) => {
          const isConfigured = device?.device_type === opt.value
          const showStatus = isConfigured && !!device?.api_key && !!deviceStatus
          return (
            <div
              key={opt.value}
              className={[
                'flex items-center gap-2 px-3 h-9 transition-colors  rounded',
                isConfigured ? 'bg-[#F2F6FE] text-theme' : 'hover:bg-[#F2F6FE] text-primary',
              ].join(' ')}
            >
              <div className="size-4 flex-center">
                <SvgIcon name="devices" />
              </div>
              <span className="text-sm leading-none">{opt.label}</span>
              {showStatus && deviceStatus && (
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
              {isConfigured && (
                <div className="ml-auto flex items-center gap-3 text-secondary">
                  <SvgIcon
                    name="equalizer"
                    size={14}
                    className="rotate-90 cursor-pointer hover:text-primary"
                    onClick={onEdit}
                  />
                  <SvgIcon
                    name="delete"
                    size={14}
                    className="cursor-pointer hover:text-red-500"
                    onClick={onRemove}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="border-t border-[#EDEEF0] mx-1 mt-1">
        <div
          className="flex items-center gap-1 px-3 h-9 text-[13px] text-[#2563EB] cursor-pointer hover:bg-[#F5F6F7]"
          onClick={onAdd}
        >
          <SvgIcon name="plus" size={14} />
          <span>添加</span>
        </div>
      </div>
    </div>
  )
}