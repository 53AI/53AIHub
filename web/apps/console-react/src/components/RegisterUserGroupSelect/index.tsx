import { useEffect, useRef, useState } from 'react'
import { Checkbox, Skeleton } from 'antd'
import { groupApi } from '@/api/modules/group'
import { GROUP_TYPE } from '@/constants/group'

interface RegisterUserGroupSelectProps {
  /** 外层受控值：注册用户分组 id 列表 */
  value?: number[]
  onChange?: (value: number[]) => void
  /** 创建模式：首次加载分组后若无值则默认全选并回传外层；编辑模式永不自动填充 */
  autoFillAll?: boolean
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
}

/**
 * 注册用户（GROUP_TYPE.USER）分组多选组件。
 * 选中态完全受外层 value 控制，变更经 onChange 回传，组件自身不持有选中状态，
 * 因此不会与外层赋值产生竞态。
 * - 创建模式（autoFillAll=true）：首次加载出分组且外层无值时，默认全选并传给外层。
 * - 编辑模式（autoFillAll=false）：永不自填，仅按外层传入的 value 勾选。
 */
function RegisterUserGroupSelectInner({
  value,
  onChange,
  autoFillAll = false,
  disabled = false,
  className,
  style,
}: RegisterUserGroupSelectProps) {
  const [options, setOptions] = useState<{ value: number; label: string }[]>([])
  const [loading, setLoading] = useState(true)

  const autoFillAllRef = useRef(autoFillAll)
  const filledRef = useRef(false)

  useEffect(() => {
    autoFillAllRef.current = autoFillAll
  }, [autoFillAll])

  useEffect(() => {
    let alive = true
    setLoading(true)
    groupApi
      .list({ params: { group_type: GROUP_TYPE.USER } })
      .then((list: unknown[]) => {
        if (!alive) return
        const mapped = ((list || []) as any[]).map((g) => ({
          value: Number(g.group_id),
          label: g.group_name ?? '',
        }))
        setOptions(mapped)
        const cur = Array.isArray(value) ? value.map(Number) : []
        if (
          !filledRef.current &&
          autoFillAllRef.current &&
          cur.length === 0 &&
          mapped.length > 0
        ) {
          filledRef.current = true
          onChange?.(mapped.map((o) => o.value))
        }
      })
      .catch((error) => {
        console.error('Load register user groups error:', error)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // 仅挂载时加载一次；value/onChange 变更不重载，避免自填与外层赋值竞态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const normalized = Array.isArray(value) ? value.map(Number) : []

  return (
    <Skeleton className="w-full" active loading={loading}>
      <Checkbox.Group
        value={normalized}
        onChange={(vals) => onChange?.(vals as number[])}
        disabled={disabled}
        className={className}
        style={style}
      >
        {options.map((opt) => (
          <Checkbox key={opt.value} value={opt.value}>
            <span className="text-primary">{opt.label}</span>
          </Checkbox>
        ))}
      </Checkbox.Group>
    </Skeleton>
  )
}

export const RegisterUserGroupSelect = RegisterUserGroupSelectInner
export default RegisterUserGroupSelect