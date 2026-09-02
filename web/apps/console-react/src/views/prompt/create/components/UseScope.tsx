import { Form } from 'antd'
import { DeptMemberPicker } from '@/components/DeptMemberPicker'
import type { ScopeItem } from '@/api/modules/agent'
import { useEnterpriseStore } from '@/stores'
import { t } from '@/locales'

interface UseScopeProps {
  /** 作用域数据 */
  value: ScopeItem[]
  /** 作用域数据变更 */
  onChange: (value: ScopeItem[]) => void
  /** 是否为新建模式（仅新建时允许 picker 自动补"全部成员"） */
  isNew?: boolean
}

export function UseScope({ value, onChange, isNew = false }: UseScopeProps) {
  const isEnterprise = useEnterpriseStore((state) => state.info.is_enterprise)
  const isIndustry = useEnterpriseStore((state) => state.info.is_industry)

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
        // 仅新建(isNew)时允许 picker 自动补"全部成员";
        // 编辑模式下 scopes 以详情接口返回为准, 空则保持为空, 不被强行覆盖
        defaultFirstValue={isNew}
      />
    </Form.Item>
  )
}

UseScope.displayName = 'UseScope'

export default UseScope
