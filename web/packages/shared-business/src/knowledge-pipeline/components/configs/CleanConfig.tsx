import { useState } from 'react'
import { Checkbox, Slider } from 'antd'
import { ToolOutlined } from '@ant-design/icons'
import { usePipelineTranslation } from '../../context'

export interface CleanRule {
  key: string
  name: string
  desc: string
  enabled: boolean
  hasThreshold?: boolean
  preview_before: string
  preview_after: string
}

export interface CleanConfigData {
  special_char_threshold?: number
  short_text_threshold?: number
  [key: string]: any
}

export interface CleanConfigProps {
  config: CleanConfigData
  onChange: (config: CleanConfigData) => void
  /** Custom clean rules. If not provided, uses default rules */
  cleanRules?: CleanRule[]
  i18nPrefix?: string
}

const getDefaultCleanRules = (t: (key: string) => string): CleanRule[] => [
  {
    key: 'invalid_tags',
    name: t('data_pipeline.clean_rule_invalid_tags'),
    desc: t('data_pipeline.clean_rule_invalid_tags_desc'),
    enabled: true,
    preview_before: '<span class="text-blue-600">&lt;页眉&gt;</span>53AIHub<span class="text-blue-600">&lt;页脚&gt;&lt;页脚&gt;&lt;页码&gt;</span>',
    preview_after: '53AIHub',
  },
  {
    key: 'spell_check',
    name: t('data_pipeline.clean_rule_spell_check'),
    desc: t('data_pipeline.clean_rule_spell_check_desc'),
    enabled: true,
    preview_before: '祝您身体<span class="text-blue-600 font-bold underline">键康</span>',
    preview_after: '祝您身体健康',
  },
  {
    key: 'special_char',
    name: t('data_pipeline.clean_rule_special_char'),
    desc: t('data_pipeline.clean_rule_special_char_desc'),
    enabled: true,
    hasThreshold: true,
    preview_before: '53AI提供企业专属© ® © 大模型开发工具链',
    preview_after: '53AI提供企业专属大模型开发工具链',
  },
  {
    key: 'pronoun_replace',
    name: t('data_pipeline.clean_rule_pronoun_replace'),
    desc: t('data_pipeline.clean_rule_pronoun_replace_desc'),
    enabled: false,
    preview_before: '它能够提供多种高级特性，<span class="text-blue-600">它</span>可以帮助你提升团队效率。',
    preview_after: '能提供多种高级特性，它可以帮助你提升团队效率。',
  },
]

export function CleanConfig({ config, onChange, cleanRules: providedCleanRules, i18nPrefix = 'data_pipeline' }: CleanConfigProps) {
  const { t } = usePipelineTranslation()
  const tKey = (key: string) => `${i18nPrefix}.${key}`

  const defaultRules = getDefaultCleanRules(t)
  const [cleanRules, setCleanRules] = useState<CleanRule[]>(providedCleanRules || defaultRules)

  const updateConfig = (patch: Partial<CleanConfigData>) => {
    onChange({ ...config, ...patch })
  }

  const handleRuleChange = (key: string, enabled: boolean) => {
    setCleanRules(prev => prev.map(rule =>
      rule.key === key ? { ...rule, enabled } : rule
    ))
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50">
            <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase font-bold">
              <th className="px-6 py-3">{t(tKey('clean_action'))}</th>
              <th className="px-6 py-3">{t(tKey('clean_preview_before'))}</th>
              <th className="px-6 py-3">{t(tKey('clean_preview_after'))}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {cleanRules.map(rule => (
              <tr key={rule.key} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-5 align-top">
                  <div className="flex gap-3">
                    <Checkbox
                      checked={rule.enabled}
                      onChange={e => handleRuleChange(rule.key, e.target.checked)}
                    />
                    <div>
                      <div className="font-bold text-gray-800 mb-1">{rule.name}</div>
                      <p className="text-xs text-gray-400 leading-relaxed max-w-[200px]">{rule.desc}</p>

                      {rule.hasThreshold && (
                        <div className="mt-4 flex items-center gap-3">
                          <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#2563EB]"
                              style={{
                                width:
                                  (rule.key === 'special_char'
                                    ? (config.special_char_threshold || 0.1) * 100
                                    : (config.short_text_threshold || 5)) + '%',
                              }}
                            />
                          </div>
                          <span className="text-[10px] font-bold text-blue-600">
                            {rule.key === 'special_char' ? config.special_char_threshold : config.short_text_threshold}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-5 align-top">
                  <div
                    className="bg-gray-50 p-3 rounded-lg text-xs font-mono text-gray-400 border border-gray-100 h-24 overflow-hidden"
                    dangerouslySetInnerHTML={{ __html: rule.preview_before }}
                  />
                </td>
                <td className="px-6 py-5 align-top">
                  <div
                    className="bg-white p-3 rounded-lg text-xs font-mono text-gray-600 border border-gray-100 h-24 overflow-hidden shadow-sm"
                    dangerouslySetInnerHTML={{ __html: rule.preview_after }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-gray-50/50 rounded-2xl p-6 border border-gray-100 space-y-8 mt-8">
        <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
          <ToolOutlined className="text-blue-600" />
          <span>{t(tKey('clean_threshold_tune'))}</span>
        </div>

        <div className="grid grid-cols-2 gap-12">
          <div className="space-y-3">
            <div className="flex justify-between">
              <label className="text-xs font-bold text-gray-400 uppercase">{t(tKey('clean_special_char_threshold'))}</label>
              <span className="text-xs font-mono text-blue-600">{config.special_char_threshold}</span>
            </div>
            <Slider
              value={config.special_char_threshold}
              onChange={(value) => updateConfig({ special_char_threshold: value })}
              min={0}
              max={1}
              step={0.01}
            />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between">
              <label className="text-xs font-bold text-gray-400 uppercase">{t(tKey('clean_short_text_threshold'))}</label>
              <span className="text-xs font-mono text-blue-600">{config.short_text_threshold}</span>
            </div>
            <Slider
              value={config.short_text_threshold}
              onChange={(value) => updateConfig({ short_text_threshold: value })}
              min={0}
              max={100}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default CleanConfig