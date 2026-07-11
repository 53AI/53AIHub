import { useMemo } from 'react'
import { Switch } from 'antd'
import './status.css'

interface ChunkStatusProps {
  value?: any
  activeText?: string
  disabledText?: string
  group?: string
  sync?: boolean
  onChange?: (value: any) => void
}

export function ChunkStatus({
  value,
  activeText = '已启用',
  disabledText = '已停用',
  group = 'group',
  sync = false,
  onChange
}: ChunkStatusProps) {
  const status = useMemo(() => Boolean(value), [value])

  const handleChange = (checked: boolean) => {
    onChange?.(checked)
    // Vue: if (props.sync) emits('update:modelValue', e)
    // React doesn't have v-model, but we keep the sync logic for consistency
  }

  return (
    <div className="flex items-center gap-2">
      {status ? (
        <div className="w-3 h-3 rounded-full bg-[#09BB07] border-2 border-[#cfedd6]" />
      ) : (
        <div className="w-3 h-3 rounded-full bg-[#FA5151] border-2 border-[#f4e1de]" />
      )}
      <div className="text-sm text-regular whitespace-nowrap">
        {status ? activeText : disabledText}
      </div>
      <div className={`hidden ${group}-hover:inline-flex`} onClick={(e) => e.stopPropagation()}>
        <Switch size="small" checked={status} onChange={handleChange} style={{ backgroundColor: status ? '#34bc24' : undefined }} />
      </div>
    </div>
  )
}

export default ChunkStatus
