import { Tooltip } from 'antd'
import { getPublicPath } from '@/utils'
import type { RecordingDeviceConfig } from '@/api/modules/recording/types'
import type { BrandCardOption } from '../../constants/brandOptions'

export type { BrandCardOption }

/**
 * 品牌选择控件：受控卡片组，向外写回 value 字符串。
 * 用 props 而非 Form.Item 自动接驳是为了不依赖 antd 的 value/onChange 双 prop
 * 兼容层；外层 Form.Item 显式声明 `valuePropName="value"` + `trigger="onChange"`。
 */
interface BrandPickerProps {
  options: BrandCardOption[]
  value?: RecordingDeviceConfig['device_type']
  onChange?: (value: RecordingDeviceConfig['device_type']) => void
}

export function BrandPicker({ options, value, onChange }: BrandPickerProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const selected = value === opt.value
        const isEnabled = opt.enabled
        const card = (
          <button
            key={opt.value}
            type="button"
            disabled={!isEnabled}
            className={[
              'flex items-center gap-2 px-3 h-9 rounded-md border transition-colors text-primary',
              selected
                ? 'border-[#2563EB] bg-[#F2F6FF] '
                : isEnabled
                  ? 'border-[#E9EEF7] bg-white text-secondary hover:border-[#2563EB] '
                  : 'border-[#E9EEF7] bg-[#F2F6FF]  cursor-not-allowed',
            ].join(' ')}
            onClick={() => {
              if (!isEnabled) return
              onChange?.(opt.value)
            }}
          >
            <img className="size-4" src={getPublicPath(`/images/recording/branch/${opt.value}.png`)} />
            <span className="text-[13px] leading-none">{opt.label}</span>
          </button>
        )
        // 禁用项用 Tooltip 包一层，给用户明确的"为什么不能选"提示
        // 已选中项不需要提示（用户已经选上了）
        if (!isEnabled && !selected && opt.disabledHint) {
          return (
            <Tooltip key={opt.value} title={opt.disabledHint} placement="top">
              {card}
            </Tooltip>
          )
        }
        return card
      })}
    </div>
  )
}