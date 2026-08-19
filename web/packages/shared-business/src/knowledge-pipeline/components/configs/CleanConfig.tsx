import { Button, Checkbox, Input, Modal, Select } from 'antd'
import { useState } from 'react'
import { usePipelineTranslation } from '../../context'

export interface CleanConfigData {
  remove_invalid_tags?: boolean
  typo_correction?: boolean
  grammar_correction?: boolean
  format_correction?: boolean
  ocr_correction?: boolean
  formula_restoration?: boolean
  sensitive_mask?: { enabled: boolean; fields: string[] }
  glossary?: { enabled: boolean; items: string[] }
  custom_prompt?: { enabled: boolean; content: string }
  [key: string]: unknown
}

export interface CleanConfigProps {
  config: CleanConfigData
  onChange: (config: CleanConfigData) => void
  i18nPrefix?: string
}

const SENTITIVE_FIELDS = [
  { key: '姓名', label: 'data_pipeline.clean_rule_sensitive_tag_name' },
  { key: '手机号', label: 'data_pipeline.clean_rule_sensitive_tag_phone' },
  { key: '邮箱', label: 'data_pipeline.clean_rule_sensitive_tag_email' },
  { key: '身份证', label: 'data_pipeline.clean_rule_sensitive_tag_id_card' },
  { key: '银行卡', label: 'data_pipeline.clean_rule_sensitive_tag_bank_card' },
  { key: 'API Key', label: 'data_pipeline.clean_rule_sensitive_tag_api_key' }
]

interface CleanRule {
  key: string
  name: string
  desc: string
  enabled: boolean
  preview_before?: string
  preview_after?: string
}

export function CleanConfig({ config, onChange, i18nPrefix = 'data_pipeline' }: CleanConfigProps) {
  const { t } = usePipelineTranslation()
  const tKey = (key: string) => `${i18nPrefix}.${key}`

  const [customPromptModalOpen, setCustomPromptModalOpen] = useState(false)
  const [customPromptDraft, setCustomPromptDraft] = useState('')

  const [glossaryModalOpen, setGlossaryModalOpen] = useState(false)
  const [glossaryDraft, setGlossaryDraft] = useState<string[]>([])

  const [localRules, setLocalRules] = useState<CleanRule[]>([
    {
      key: 'remove_invalid_tags',
      name: t('data_pipeline.clean_rule_invalid_tags'),
      desc: t('data_pipeline.clean_rule_invalid_tags_desc'),
      enabled: config.remove_invalid_tags ?? true,
      preview_before:
        '<span class="text-blue-600">&lt;页眉&gt;</span>53AIHub<span class="text-blue-600">&lt;页脚&gt;&lt;页脚&gt;&lt;页码&gt;</span>',
      preview_after: '53AIHub'
    },
    {
      key: 'typo_correction',
      name: t('data_pipeline.clean_rule_spell_check'),
      desc: t('data_pipeline.clean_rule_spell_check_desc'),
      enabled: config.typo_correction ?? true,
      preview_before: '祝您身体<span class="text-blue-600 ">键康</span>',
      preview_after: '祝您身体健康'
    },
    {
      key: 'grammar_correction',
      name: t('data_pipeline.clean_rule_grammar'),
      desc: t('data_pipeline.clean_rule_grammar_desc'),
      enabled: config.grammar_correction ?? false,
      preview_before: '<span class="text-blue-600 ">由于由于</span>技术原因，系统暂时无法服务',
      preview_after: '由于技术原因，系统暂时无法服务'
    },
    {
      key: 'format_correction',
      name: t('data_pipeline.clean_rule_format'),
      desc: t('data_pipeline.clean_rule_format_desc'),
      enabled: config.format_correction ?? true,
      preview_before:
        '<span class="text-blue-600 ">**</span>加粗文本并缺失闭合<span class="text-blue-600 ">**</span>',
      preview_after: '**加粗文本并缺失闭合**'
    },
    {
      key: 'ocr_correction',
      name: t('data_pipeline.clean_rule_ocr'),
      desc: t('data_pipeline.clean_rule_ocr_desc'),
      enabled: config.ocr_correction ?? true,
      preview_before:
        '请确认<span class="text-blue-600">[o]</span>已完成，<span class="text-blue-600">×</span>未完成。',
      preview_after: '请确认✅已完成，❌未完成。'
    },
    {
      key: 'formula_restoration',
      name: t('data_pipeline.clean_rule_formula'),
      desc: t('data_pipeline.clean_rule_formula_desc'),
      enabled: config.formula_restoration ?? false,
      preview_before: '<span class="text-blue-600 font-bold ">E = m c ^ 2</span>',
      preview_after: 'E = mc²'
    },
    {
      key: 'sensitive_mask',
      name: t('data_pipeline.clean_rule_sensitive'),
      desc: t('data_pipeline.clean_rule_sensitive_desc'),
      enabled: config.sensitive_mask?.enabled ?? false,
      preview_before:
        '电话号码：<span class="text-blue-600 ">13812345678</span><br/>电子邮箱：<span class="text-blue-600 ">138123124@126.com</span>',
      preview_after: '电话号码：13*******78<br/>电子邮箱：13****4@1**.*om'
    },
    {
      key: 'glossary',
      name: t('data_pipeline.clean_rule_dictionary'),
      desc: t('data_pipeline.clean_rule_dictionary_desc'),
      enabled: config.glossary?.enabled ?? false,
      preview_before:
        '客户作为保单<span class="text-blue-600 ">被保险的人</span>，申请办理<span class="text-blue-600 ">忧郁期<</span>内退保业务',
      preview_after: '客户作为保单被保险人，申请办理犹豫期退保保全业务'
    },
    {
      key: 'custom_prompt',
      name: t('data_pipeline.clean_rule_custom'),
      desc: t('data_pipeline.clean_rule_custom_desc'),
      enabled: config.custom_prompt?.enabled ?? false,
      preview_before:
        '<span class="text-blue-600 ">那个...嗯</span>，客户说然后保单要申请办理退保，<span class="text-blue-600 ">对吧，然后</span>麻烦尽快处理一下。',
      preview_after: '客户申请办理保单退保保全业务，麻烦尽快处理。'
    }
  ])

  const updateConfig = (patch: Partial<CleanConfigData>) => {
    onChange({ ...config, ...patch })
  }

  const handleRuleChange = (key: string, enabled: boolean) => {
    setLocalRules((prev) => prev.map((rule) => (rule.key === key ? { ...rule, enabled } : rule)))

    if (key === 'sensitive_mask') {
      updateConfig({
        sensitive_mask: {
          ...config.sensitive_mask,
          enabled,
          fields: config.sensitive_mask?.fields || []
        }
      })
    } else if (key === 'glossary') {
      updateConfig({
        glossary: { ...config.glossary, enabled, items: config.glossary?.items || [] }
      })
    } else if (key === 'custom_prompt') {
      updateConfig({
        custom_prompt: {
          ...config.custom_prompt,
          enabled,
          content: config.custom_prompt?.content || ''
        }
      })
    } else {
      updateConfig({ [key]: enabled })
    }
  }

  const updateSensitiveMask = (patch: Partial<CleanConfigData['sensitive_mask']>) => {
    onChange({
      ...config,
      sensitive_mask: {
        ...config.sensitive_mask,
        enabled: true,
        fields: config.sensitive_mask?.fields || [],
        ...patch
      }
    })
  }

  const updateCustomPrompt = (patch: Partial<CleanConfigData['custom_prompt']>) => {
    onChange({
      ...config,
      custom_prompt: {
        ...config.custom_prompt,
        enabled: true,
        content: config.custom_prompt?.content || '',
        ...patch
      }
    })
  }

  const toggleSensitiveField = (field: string) => {
    const currentFields = config.sensitive_mask?.fields || []
    const newFields = currentFields.includes(field)
      ? currentFields.filter((f) => f !== field)
      : [...currentFields, field]
    updateSensitiveMask({ fields: newFields })
  }

  const renderComplexConfig = (rule: CleanRule) => {
    if (rule.key === 'sensitive_mask') {
      return (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {SENTITIVE_FIELDS.map((field) => (
            <button
              key={field.key}
              type="button"
              onClick={() => toggleSensitiveField(field.key)}
              className={`h-5 px-1.5 flex items-center text-xs rounded  transition-colors ${
                config.sensitive_mask?.fields?.includes(field.key)
                  ? 'bg-blue-50 text-blue-600'
                  : 'bg-white text-gray-600'
              }`}
            >
              {t(field.label)}
            </button>
          ))}
        </div>
      )
    }
    if (rule.key === 'glossary') {
      const openGlossaryModal = () => {
        setGlossaryDraft(config.glossary?.items || [])
        setGlossaryModalOpen(true)
      }
      return (
        <div className="relative">
          <Select
            className="w-full"
            mode="multiple"
            value={config.glossary?.items}
            suffixIcon={null}
            maxTagCount="responsive"
            placeholder={t('data_pipeline.clean_rule_dictionary_placeholder')}
          />
          <button
            type="button"
            aria-label={t('data_pipeline.clean_rule_dictionary_edit')}
            className="absolute inset-0 cursor-pointer bg-transparent border-0"
            onClick={openGlossaryModal}
          />
        </div>
      )
    }
    if (rule.key === 'custom_prompt') {
      return (
        <Button
          color="primary"
          variant="link"
          className="px-0"
          onClick={() => {
            setCustomPromptDraft(config.custom_prompt?.content || '')
            setCustomPromptModalOpen(true)
          }}
        >
          {t('data_pipeline.clean_rule_custom_action')}
        </Button>
      )
    }
    return null
  }

  const handleCustomPromptConfirm = () => {
    updateCustomPrompt({
      enabled: config.custom_prompt?.enabled ?? true,
      content: customPromptDraft
    })
    setCustomPromptModalOpen(false)
  }

  const handleCustomPromptCancel = () => {
    setCustomPromptModalOpen(false)
  }

  const updateGlossary = (patch: Partial<CleanConfigData['glossary']>) => {
    onChange({
      ...config,
      glossary: {
        ...config.glossary,
        enabled: true,
        items: config.glossary?.items || [],
        ...patch
      }
    })
  }

  const handleGlossaryConfirm = () => {
    updateGlossary({
      enabled: config.glossary?.enabled ?? true,
      items: glossaryDraft
    })
    setGlossaryModalOpen(false)
  }

  const handleGlossaryCancel = () => {
    setGlossaryModalOpen(false)
  }

  const renderPreviewCell = (rule: CleanRule) => {
    return (
      <>
        <td className="px-6 py-5 align-top">
          <div
            className="text-xs text-gray-400"
            dangerouslySetInnerHTML={{ __html: rule.preview_before || '' }}
          />
        </td>
        <td className="px-6 py-5 align-top">
          <div
            className="text-xs text-[#999]"
            dangerouslySetInnerHTML={{ __html: rule.preview_after || '' }}
          />
        </td>
      </>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50">
            <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase font-bold">
              <th className="px-6 py-4">{t(tKey('clean_action'))}</th>
              <th className="px-6 py-4">{t(tKey('clean_preview_before'))}</th>
              <th className="px-6 py-4">{t(tKey('clean_preview_after'))}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {localRules.map((rule) => (
              <tr key={rule.key} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-5 align-top">
                  <div className="flex gap-3 items-start">
                    <Checkbox
                      checked={rule.enabled}
                      onChange={(e) => handleRuleChange(rule.key, e.target.checked)}
                    />
                    <div>
                      <div className="font-bold text-gray-800 mb-1">{rule.name}</div>
                      <p className="text-xs text-gray-400 leading-relaxed max-w-[200px]">
                        {rule.desc}
                      </p>
                      {['sensitive_mask', 'glossary', 'custom_prompt'].includes(rule.key) &&
                        renderComplexConfig(rule)}
                    </div>
                  </div>
                </td>
                {renderPreviewCell(rule)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={customPromptModalOpen}
        title={t('data_pipeline.clean_rule_custom')}
        onOk={handleCustomPromptConfirm}
        onCancel={handleCustomPromptCancel}
        okText={t('action.confirm')}
        cancelText={t('action.cancel')}
        destroyOnHidden
        width={520}
      >
        <Input.TextArea
          value={customPromptDraft}
          onChange={(e) => setCustomPromptDraft(e.target.value)}
          placeholder={t('data_pipeline.clean_rule_custom_placeholder')}
          maxLength={500}
          showCount
          style={{ resize: 'none' }}
          rows={10}
        />
      </Modal>

      <Modal
        open={glossaryModalOpen}
        title={t('data_pipeline.clean_rule_dictionary_edit')}
        onOk={handleGlossaryConfirm}
        onCancel={handleGlossaryCancel}
        okText={t('action.confirm')}
        cancelText={t('action.cancel')}
        destroyOnHidden
        width={520}
      >
        <Select
          mode="tags"
          style={{ width: '100%', minHeight: 250 }}
          value={glossaryDraft}
          onChange={(value) => setGlossaryDraft(value)}
          tokenSeparators={[',', '、', '，', '；']}
          placeholder={t('data_pipeline.clean_rule_dictionary_placeholder')}
          open={false}
          suffixIcon={null}
        />
      </Modal>
    </div>
  )
}

export default CleanConfig
