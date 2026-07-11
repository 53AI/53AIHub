import { memo, useCallback } from 'react'

import { Form } from 'antd'

import { GROUP_TYPE } from '@/constants/group'
import { useEnterpriseStore } from '@/stores/modules/enterprise'
import GroupSelect from '@/components/GroupSelect'
import { t } from '@/locales'

// ============================================================================
// Types
// ============================================================================

export interface UseGroupProps {
  /** 内部用户分组 ID 列表 */
  userGroup: number[]
  /** 注册用户分组 ID 列表 */
  subscriptionGroup: number[]
  /** 是否可编辑 */
  editable: boolean
  /** 分组变更回调 */
  onChange: (payload: { groupType: number; data: number[] }) => void
}

// ============================================================================
// Component
// ============================================================================

function UseGroupInternal({ userGroup, subscriptionGroup, editable, onChange }: UseGroupProps) {
  const enterprise = useEnterpriseStore()

  // 处理注册用户分组变更
  const handleSubscriptionGroupChange = useCallback(
    (value: number[]) => {
      onChange({ groupType: GROUP_TYPE.USER, data: value })
    },
    [onChange],
  )

  // 处理内部用户分组变更
  const handleUserGroupChange = useCallback(
    (value: number[]) => {
      onChange({ groupType: GROUP_TYPE.INTERNAL_USER, data: value })
    },
    [onChange],
  )

  // 判断是否显示注册用户分组
  const showSubscriptionGroup = enterprise.info.is_independent || enterprise.info.is_industry

  // 判断是否显示内部用户分组
  const showUserGroup = enterprise.info.is_enterprise || enterprise.info.is_industry

  return (
    <Form layout="vertical">
      {showSubscriptionGroup && (
        <Form.Item label={t('register_user.title')} style={{ marginBottom: 12 }}>
          <GroupSelect
            value={subscriptionGroup}
            onChange={handleSubscriptionGroupChange}
            groupType={GROUP_TYPE.USER}
            multiple
            type="checkbox"
            defaultAll={!editable}
          />
        </Form.Item>
      )}
      {showUserGroup && (
        <Form.Item label={t('internal_user.title')} style={{ marginBottom: 0 }}>
          <GroupSelect
            value={userGroup}
            onChange={handleUserGroupChange}
            groupType={GROUP_TYPE.INTERNAL_USER}
            multiple
            type="picker"
          />
        </Form.Item>
      )}
    </Form>
  )
}

UseGroupInternal.displayName = 'UseGroup'

export const UseGroup = memo(UseGroupInternal)

export default UseGroup
