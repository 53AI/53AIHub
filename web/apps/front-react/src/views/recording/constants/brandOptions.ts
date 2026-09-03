import type { RecordingDeviceConfig } from '@/api/modules/recording/types'

/**
 * 接入弹窗里的品牌选项数据。
 *
 * - SonicNote：已对接，MCP Key `sk-` 开头
 * - TicNote：已对接，AppKey `tncn_sk_` / `tnovs_sk_` 开头
 * - SoniNote：占位，UI 禁用，hover 提示
 */
export type BrandCardOption = {
  /** 写回表单 brand 字段，对应后端 device_type */
  value: RecordingDeviceConfig['device_type']
  label: string
  enabled: boolean
  /** 仅 disabled 项生效；hover 提示文案 */
  disabledHint?: string
}

/** 设备类型常量：单一来源，避免散落 magic string */
export const SONICNOTE_DEVICE_TYPE = 'sonicnote' as const
export const TICNOTE_DEVICE_TYPE = 'ticnote' as const
export const SONINOTE_DEVICE_TYPE = 'soninote' as const

/** 已对接的设备类型（用于多 key / 自动同步 / 探测等核心流程） */
export type SupportedDeviceType =
  | typeof SONICNOTE_DEVICE_TYPE
  | typeof TICNOTE_DEVICE_TYPE

/** 已启用品牌的设备类型联合（排除占位 soninote） */
export type DeviceType = SupportedDeviceType

export const BRAND_OPTIONS: BrandCardOption[] = [
  { value: SONICNOTE_DEVICE_TYPE, label: 'SonicNote', enabled: true },
  { value: TICNOTE_DEVICE_TYPE, label: 'TicNote', enabled: true },
  { value: SONINOTE_DEVICE_TYPE, label: 'SoniNote', enabled: false, disabledHint: '敬请期待' },
]
