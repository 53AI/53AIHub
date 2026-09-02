import { memo } from 'react'

import { Form } from 'antd'

import { useEnterpriseStore } from '@/stores/modules/enterprise'
import RegisterUserGroupSelect from '@/components/RegisterUserGroupSelect'
import type { ScopeItem } from '@/api/modules/agent'
import { t } from '@/locales'

import UseScope from './UseScope'

// ============================================================================
// Types
// ============================================================================

export interface UseGroupProps {
  /** 内部用户作用域 */
  scopes: ScopeItem[]
  /** 注册用户分组 ID 列表（外层受控） */
  subscriptionGroup: number[]
  /** 注册用户分组变更 */
  onSubscriptionGroupChange: (value: number[]) => void
  /** 内部用户作用域变更 */
  onScopesChange: (value: ScopeItem[]) => void
  /** 创建模式：注册用户分组加载后无值时默认全选 */
  autoFillAll?: boolean
  /** 是否为新建模式（决定内部用户作用域是否默认"全部成员"） */
  isNew?: boolean
}

// ============================================================================
// Component
// ============================================================================

function UseGroupInternal({
  scopes,
  subscriptionGroup,
  onSubscriptionGroupChange,
  onScopesChange,
  autoFillAll = false,
  isNew = false,
}: UseGroupProps) {
  const enterprise = useEnterpriseStore()

  // 判断是否显示注册用户分组
  const showSubscriptionGroup = enterprise.info.is_independent || enterprise.info.is_industry

  return (
    <Form layout="vertical">
      {showSubscriptionGroup && (
        <Form.Item label={t('register_user.title')} style={{ marginBottom: 12 }}>
          <RegisterUserGroupSelect
            value={subscriptionGroup}
            onChange={onSubscriptionGroupChange}
            autoFillAll={autoFillAll}
          />
        </Form.Item>
      )}
      <UseScope value={scopes} onChange={onScopesChange} isNew={isNew} />
    </Form>
  )
}

UseGroupInternal.displayName = 'UseGroup'

export const UseGroup = memo(UseGroupInternal)

export default UseGroup
