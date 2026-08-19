import type { RecordingDeviceConfig } from '@/api/modules/recording/types'

/**
 * 接入弹窗里的品牌选项数据。
 * 当前仅 SonicNote 可用；SoniNote / TicNote 暂未接入，UI 占位并禁用，
 * hover 显示"敬请期待"提示，避免用户误以为能选。
 */
export type BrandCardOption = {
  /** 写回表单 brand 字段，对应后端 device_type */
  value: RecordingDeviceConfig['device_type']
  label: string
  enabled: boolean
  /** 仅 disabled 项生效；hover 提示文案 */
  disabledHint?: string
}

export const BRAND_OPTIONS: BrandCardOption[] = [
  { value: 'sonicnote', label: 'SonicNote', enabled: true },
  { value: 'soninote', label: 'SoniNote', enabled: false, disabledHint: '敬请期待' },
  { value: 'ticnote', label: 'TicNote', enabled: false, disabledHint: '敬请期待' },
]

/** 当前唯一已接入的设备类型——所有设备相关逻辑都围绕它展开 */
export const SONICNOTE_DEVICE_TYPE: RecordingDeviceConfig['device_type'] =
  'sonicnote'