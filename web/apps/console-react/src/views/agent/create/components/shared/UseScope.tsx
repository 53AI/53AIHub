import { useRef } from 'react'
import { Form } from 'antd'
import { t } from '@/locales'
import { useAgentForm } from '../../hooks'
import { GroupSelect, GroupOption } from '@/components/GroupSelect'
import { GROUP_TYPE } from '@/constants/group'
import { useEnterpriseStore } from '@/stores'

export function UseScope() {
  // 使用 hook 获取状态和方法
  const { formData, updateField, isNew } = useAgentForm()
  const subscriptionGroupIds = formData.subscription_group_ids
  const userGroupIds = formData.user_group_ids

  // 使用选择器获取 enterprise 数据
  const isIndependent = useEnterpriseStore(state => state.info.is_independent)
  const isIndustry = useEnterpriseStore(state => state.info.is_industry)
  const isEnterprise = useEnterpriseStore(state => state.info.is_enterprise)

  // 记录是否已应用默认值，避免重复设置
  const didApplySubscriptionDefaultRef = useRef(false)
  const didApplyUserDefaultRef = useRef(false)

  return (
    <>
      <Form.Item
        hidden={!(isIndependent || isIndustry)}
        label={t('register_user.title')}
        style={{ marginBottom: '12px' }}
      >
        <GroupSelect
          value={subscriptionGroupIds || []}
          onChange={(value) => updateField('subscription_group_ids', value)}
          type="checkbox"
          groupType={GROUP_TYPE.USER}
          multiple
          onOptionsLoad={(options: GroupOption[]) => {
            // 创建新智能体时，默认全选注册用户
            if (isNew && !didApplySubscriptionDefaultRef.current && options.length > 0) {
              const isEmpty = !subscriptionGroupIds || subscriptionGroupIds.length === 0
              if (isEmpty) {
                didApplySubscriptionDefaultRef.current = true
                updateField('subscription_group_ids', options.map(opt => opt.group_id))
              }
            }
          }}
        />
      </Form.Item>
      <Form.Item
        hidden={!(isEnterprise || isIndustry)}
        label={t('internal_user.title')}
      >
        <GroupSelect
          value={userGroupIds || []}
          onChange={(value) => updateField('user_group_ids', value)}
          type="picker"
          groupType={GROUP_TYPE.INTERNAL_USER}
          multiple
          onOptionsLoad={(options: GroupOption[]) => {
            // 创建新智能体时，默认全选内部用户
            if (isNew && !didApplyUserDefaultRef.current && options.length > 0) {
              const isEmpty = !userGroupIds || userGroupIds.length === 0
              if (isEmpty) {
                didApplyUserDefaultRef.current = true
                updateField('user_group_ids', options.map(opt => opt.group_id))
              }
            }
          }}
        />
      </Form.Item>
    </>
  )
}

export default UseScope
