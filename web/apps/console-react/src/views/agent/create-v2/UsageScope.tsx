import { InputNumber, Form } from 'antd'
import { useAgentFormStore } from '@km/shared-business/agent-create'
import { RegisterUserGroupSelect } from '@/components/RegisterUserGroupSelect'
import { DeptMemberPicker } from '@/components/DeptMemberPicker'
import type { ScopeItem } from '@/api/modules/agent'
import { useEnterpriseStore } from '@/stores'
import { t } from '@/locales'

/**
 * Agent 创建页「使用范围」区块（console 本地组合）。
 * 排序 + 注册用户分组 + 内部用户作用域，直接读写 shared 的 useAgentFormStore。
 * 通过 CreatePageLayout 的 usageScope 插槽注入；front 端不传，保持隐藏。
 */
export function UsageScope() {
  const isNew = useAgentFormStore((state) => state.is_new)
  const sort = useAgentFormStore((state) => state.form_data.sort)
  const subscriptionGroupIds = useAgentFormStore(
    (state) => state.form_data.subscription_group_ids,
  )
  const scopes = useAgentFormStore((state) => state.form_data.scopes)
  const updateField = useAgentFormStore((state) => state.updateField)

  const info = useEnterpriseStore((state) => state.info)
  const showRegisterUser = info.is_independent || info.is_industry
  const showInternalUser = info.is_enterprise || info.is_industry

  return (
    <>
      <div className="mt-5 border-b "></div>
      <div className="h-11 flex items-center gap-2">
        <div className="text-sm text-[#373A3D]">{t('agent.frontend_sort')}</div>
        <span className="text-xs text-disabled">
          {t('module.agent_sort_desc')}
        </span>
      </div>
      <InputNumber
        className="w-full"
        controls={false}
        precision={0}
        min={0}
        max={99999999}
        value={sort}
        onChange={(value) => updateField('sort', value ?? 0)}
        placeholder={t('form.input_placeholder')}
      />
      <div className="my-5 -mx-5 border-b "></div>
      <div className="font-bold mb-3">{t('user.use_scope')}</div>
      <Form layout="vertical">
        {showRegisterUser && (
          <Form.Item label={t('register_user.title')} style={{ marginBottom: 12 }}>
            <RegisterUserGroupSelect
              value={subscriptionGroupIds || []}
              onChange={(val) => updateField('subscription_group_ids', val)}
              autoFillAll={isNew}
            />
          </Form.Item>
        )}
        {showInternalUser && (
          <Form.Item label={t('internal_user.title')} style={{ marginBottom: 0 }}>
            <DeptMemberPicker
              type="scope"
              simpleValue
              value={scopes || []}
              onChange={(val) => updateField('scopes', val as ScopeItem[])}
              defaultFirstValue={isNew}
              showGroup
            />
          </Form.Item>
        )}
      </Form>
    </>
  )
}

export default UsageScope
