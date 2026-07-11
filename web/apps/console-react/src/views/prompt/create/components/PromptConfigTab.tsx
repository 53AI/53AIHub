import { Button, Form, InputNumber, Tooltip } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { usePromptFormDataStore } from '../store'
import { GroupSelect } from '@/components/GroupSelect'
import { GROUP_TYPE } from '@/constants/group'
import { useEnterpriseStore } from '@/stores'
import { SvgIcon, PromptInput } from '@km/shared-components-react'
import GuideView from '../Guide'
import { t } from '@/locales'
import PromptPreview from './PromptPreview'
import { copyToClip } from '@km/shared-utils'
import { message } from 'antd'

interface PromptConfigTabProps {
  form: any
  onOpenLinksDialog: () => void
  onOpenStoreDialog: () => void
  onDeleteLink: (item: any) => void
}

export function PromptConfigTab({
  form,
  onOpenLinksDialog,
  onOpenStoreDialog,
  onDeleteLink,
}: PromptConfigTabProps) {
  const enterpriseStore = useEnterpriseStore()

  const formData = usePromptFormDataStore((state) => state.formData)
  const setFormData = usePromptFormDataStore((state) => state.set)

  const prompt = formData.content || ''

  const onPromptChange = (value: string) => {
    setFormData({ content: value })
    form.setFieldValue('content', value)
  }

  const onCopy = async (text: string) => {
    await copyToClip(text)
    message.success(t('action.copy_success'))
  }

  return (
    <Form form={form} className="h-full flex min-h-0" layout="vertical">
      <div className="w-2/3 flex flex-col">
        <div className="h-14 flex items-center px-6 font-base text-primary border-b border-[#E9EEF7]">
          {t('agent.config_title')}
        </div>
        <div className="flex-1 min-h-0 flex">
          {/* 第一列：Prompt 内容 + 排序 + 使用场景 + 用户分组 */}
          <div className="flex-1 px-5 py-2 border-r overflow-y-auto">
            {/* Prompt 内容 */}
            <div className="flex-1 min-h-0 flex flex-col relative">
              <div className="h-11 flex items-center">
                <div
                  className="flex-1 text-sm text-[var(--ant-form-label-color)] truncate"
                  title={t('prompt.content')}
                >
                  {t('prompt.content')}
                </div>
                <div className="flex items-center gap-1">
                  <Tooltip placement="top" title={t('action.copy')}>
                    <span
                      className="text-[#182B50] px-1 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        onCopy(prompt)
                      }}
                    >
                      <SvgIcon name="copy" size="18px" />
                    </span>
                  </Tooltip>
                </div>
              </div>
              <div className="flex-1 border rounded-xl bg-white overflow-y-auto">
                <PromptInput
                  value={prompt}
                  onChange={onPromptChange}
                  style={{
                    height: '100%',
                    minHeight: '200px',
                    borderRadius: 4,
                  }}
                  placeholder={t('prompt.role_instruction_placeholder')}
                  wordWrap
                  t={t}
                />
              </div>
            </div>


            {/* AI Links */}
            <div className="mt-4 border-t"></div>
            <div>
              <div className="h-11 flex items-center justify-between">
                <h3 className="text-sm text-primary">{t('prompt.ai_links')}</h3>
                <Button color="default" variant="link" className="px-0" onClick={() => onOpenStoreDialog()}>
                  <SvgIcon name="plus" size={16} />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.ai_links
                  ?.filter((item: any) => !item.delete)
                  .map((item: any, index: number) => (
                    <div
                      key={item.ai_link?.url || item.ai_link?.name || `link-${index}`}
                      className="h-8 flex items-center gap-2 px-3 border rounded-md hover:shadow-md bg-white"
                    >
                      <img
                        className="size-5 rounded-full"
                        src={item.ai_link?.logo}
                        alt=""
                      />
                      <p className="text-sm text-primary">
                        {item.ai_link?.name}
                      </p>
                      <CloseOutlined
                        className="cursor-pointer hover:opacity-50 text-xs"
                        onClick={() => onDeleteLink(item)}
                      />
                    </div>
                  ))}
              </div>
            </div>

            {/* 排序 */}
            <div className="mt-4 border-t"></div>
            <div className="h-11 flex items-center gap-2">
              <div className="text-sm text-primary">{t('prompt.frontend_sort')}</div>
              <span className="text-xs text-disabled">
                {t('module.agent_sort_desc')}
              </span>
            </div>
            <Form.Item name="sort">
              <InputNumber
                className="w-full"
                controls={false}
                precision={0}
                min={0}
                max={99999999}
                placeholder={t('form.input_placeholder')}
              />
            </Form.Item>
            {/* 使用范围 */}
            <div className="my-4 border-t"></div>
            <div className="font-bold mb-3">{t('usage_range')}</div>
            {/* Subscription groups */}
            <Form.Item
              label={t('register_user.title')}
              name="subscription_group_ids"
              hidden={
                !(
                  enterpriseStore.info.is_independent ||
                  enterpriseStore.info.is_industry
                )
              }
            >
              <GroupSelect
                groupType={GROUP_TYPE.USER}
                type="checkbox"
                defaultAll={formData.prompt_id === 0}
              />
            </Form.Item>

            {/* User groups */}
            <Form.Item
              label={t('internal_user.title')}
              name="user_group_ids"
              hidden={
                !(
                  enterpriseStore.info.is_enterprise ||
                  enterpriseStore.info.is_industry
                )
              }
            >
              <GroupSelect groupType={GROUP_TYPE.INTERNAL_USER} type="picker" defaultAll={formData.prompt_id === 0} />
            </Form.Item>
          </div>

          {/* 第二列：使用指南 */}
          <div className="flex-1 px-5 py-4 overflow-y-auto">
            <GuideView />
          </div>
        </div>
      </div>

      {/* 第三列：预览区域 */}
      <div className="w-1/3 border-l bg-white flex flex-col">
        <div className="flex-none h-14 flex items-center justify-between px-6 font-base text-primary">
          <span>{t('app.debug_preview')}</span>
        </div>
        <div className="flex-1 min-h-0">
          <PromptPreview />
        </div>
      </div>
    </Form>
  )
}

export default PromptConfigTab