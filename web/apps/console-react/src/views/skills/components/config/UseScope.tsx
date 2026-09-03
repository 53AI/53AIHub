import { Form } from 'antd'
import { useRef, useEffect } from 'react'
import { DeptMemberPicker } from '@/components/DeptMemberPicker'
import type { ScopeItem } from '@/api/modules/agent'
import { useEnterpriseStore } from '@/stores'
import { t } from '@/locales'

interface UseScopeProps {
  /** 作用域数据 */
  value: ScopeItem[]
  /** 作用域数据变更 */
  onChange: (value: ScopeItem[]) => void
  /** 是否为新建模式（用于应用默认值） */
  isNew?: boolean
}

export function UseScope({ value, onChange, isNew = false }: UseScopeProps) {
  const isEnterprise = useEnterpriseStore((state) => state.info.is_enterprise)
  const isIndustry = useEnterpriseStore((state) => state.info.is_industry)

  // 记录是否已应用默认值，避免重复设置
  const didApplyDefaultRef = useRef(false)

  // 新建时：默认全选"全部成员" (scope_type: 'company')
  useEffect(() => {
    if (!isNew) return
    if (didApplyDefaultRef.current) return
    if (!isEnterprise && !isIndustry) return
    if (value && value.length > 0) {
      didApplyDefaultRef.current = true
      return
    }
    didApplyDefaultRef.current = true
    onChange([{ scope_type: 'company', target_id: 0 }])
  }, [isNew, isEnterprise, isIndustry, value, onChange])

  // 仅在企业版/行业版显示内部用户作用域
  if (!isEnterprise && !isIndustry) {
    return null
  }

  return (
    <Form.Item label={t('internal_user.title')}>
      <DeptMemberPicker
        type="scope"
        simpleValue
        value={value || []}
        onChange={onChange}
        showGroup
        // 仅新建(isNew)时允许 picker 自动补"全公司";
        // 编辑模式下用户清空 scopes 后不应被 picker 强行覆盖
        defaultFirstValue={isNew}
      />
    </Form.Item>
  )
}

UseScope.displayName = 'UseScope'

export default UseScope
