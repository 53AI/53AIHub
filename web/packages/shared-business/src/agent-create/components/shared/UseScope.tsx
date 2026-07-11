import { useRef, useEffect } from 'react';
import { Form } from 'antd';
import { useAgentCreateAdapter } from '../../adapters';
import { useAgentForm } from '../../hooks';
import { useAgentFormStore } from '../../store';
import type { ScopeItem } from '../../adapters/types';

type GroupSelectValue = number | number[] | ScopeItem[];

function isScopeItem(value: unknown): value is ScopeItem {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'scope_type' in value &&
    'target_id' in value
  );
}

export function UseScope() {
  // 使用 adapter 获取翻译函数和组件
  const adapter = useAgentCreateAdapter();
  const t = adapter.t || ((key: string) => key);
  const GroupSelect = adapter.GroupSelectComponent;

  // 使用 hook 获取状态和方法
  const { formData, updateField, isNew } = useAgentForm()
  const subscriptionGroupIds = formData.subscription_group_ids
  const scopes = formData.scopes

  // 使用 adapter 获取企业信息
  const isIndependent = adapter.isIndependent || false
  const isIndustry = adapter.isIndustry || false
  const isEnterprise = adapter.isEnterprise || false

  // 缓存注册用户分组选项
  const subscriptionOptionsRef = useRef<any[]>([])

  // 记录是否已应用默认值
  const didApplySubscriptionDefaultRef = useRef(false)
  const didApplyScopesDefaultRef = useRef(false)

  // 当 isNew 变化时，重置已应用标记
  const prevIsNewRef = useRef(isNew)
  useEffect(() => {
    if (prevIsNewRef.current !== isNew) {
      prevIsNewRef.current = isNew
      didApplySubscriptionDefaultRef.current = false
      didApplyScopesDefaultRef.current = false
    }
  }, [isNew])

  // 新建模式下应用默认值；编辑模式不做任何处理，按接口返回值显示
  useEffect(() => {
    if (!isNew) {
      return
    }

    // 注册用户分组默认值
    if (!didApplySubscriptionDefaultRef.current && subscriptionOptionsRef.current.length > 0) {
      const currentValue = useAgentFormStore.getState().form_data.subscription_group_ids
      if (!currentValue || currentValue.length === 0) {
        didApplySubscriptionDefaultRef.current = true
        updateField('subscription_group_ids', subscriptionOptionsRef.current.map(opt => opt.group_id))
      }
    }

    // 内部用户（scopes）默认值：新建模式下默认选中"全部成员"
    if (!didApplyScopesDefaultRef.current && (isEnterprise || isIndustry)) {
      const currentValue = useAgentFormStore.getState().form_data.scopes
      if (!currentValue || currentValue.length === 0) {
        didApplyScopesDefaultRef.current = true
        updateField('scopes', [{ scope_type: 'company', target_id: 0 }])
      }
    }
  }, [isNew, updateField, isEnterprise, isIndustry])

  // 如果没有 GroupSelect 组件，则不渲染
  if (!GroupSelect) {
    return null
  }

  const handleSubscriptionGroupChange = (value: GroupSelectValue) => {
    if (!Array.isArray(value)) {
      updateField('subscription_group_ids', [value])
      return
    }
    const items: Array<number | ScopeItem> = value
    updateField('subscription_group_ids', items.filter((item): item is number => typeof item === 'number'))
  }

  const handleScopesChange = (value: GroupSelectValue) => {
    if (!Array.isArray(value)) {
      updateField('scopes', [])
      return
    }
    const items: Array<number | ScopeItem> = value
    updateField('scopes', items.filter(isScopeItem))
  }

  return (
    <>
      <Form.Item
        hidden={!(isIndependent || isIndustry)}
        label={t('user.register_user')}
        style={{ marginBottom: '12px' }}
        layout="vertical"

      >
        <GroupSelect
          value={subscriptionGroupIds || []}
          onChange={handleSubscriptionGroupChange}
          type="checkbox"
          groupType={adapter.GROUP_TYPE?.USER || 'user'}
          multiple
          onOptionsLoad={(options: any[]) => {
            // 缓存选项
            subscriptionOptionsRef.current = options
          }}
        />
      </Form.Item>
      <Form.Item
        hidden={!(isEnterprise || isIndustry)}
        label={t('user.internal_user')}
        layout="vertical"
      >
        <GroupSelect
          value={scopes}
          onChange={handleScopesChange}
          type="scope"
          defaultFirstValue={isNew}
          simpleValue
        />
      </Form.Item>
    </>
  )
}

export default UseScope
