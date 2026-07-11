import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { Checkbox, Slider } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import './CleanConfig.css'

interface CleanConfigProps {
  config: any
  onChange?: (config: any) => void
}

interface CleanRule {
  key: string
  name: string
  desc: string
  enabled: boolean
  hasThreshold?: boolean
  preview_before: string
  preview_after: string
}

// 规则 key 与 config 字段的映射
const RULE_CONFIG_MAP: Record<string, string> = {
  invalid_tags: 'remove_invalid_tags',
  spell_check: 'typo_correction',
  special_char: 'special_char_filter',
  pronoun_replace: 'pronoun_replacement',
}

// 默认规则配置
const DEFAULT_RULES: Omit<CleanRule, 'enabled'>[] = [
  {
    key: 'invalid_tags',
    name: '移除无效标签',
    desc: '移除文档中的页眉、页脚、页码、脚注等无效标签。',
    preview_before:
      '<span class="text-[#2563EB]">&lt;页眉&gt;</span>53AIHub<span class="text-[#2563EB]">&lt;页脚&gt;&lt;页脚&gt;&lt;页码&gt;</span>',
    preview_after: '53AIHub',
  },
  {
    key: 'spell_check',
    name: '错别字纠正',
    desc: '识别并纠正原文中的错别字。',
    preview_before: '祝您身体<span class="text-[#2563EB] font-bold underline">键康</span>',
    preview_after: '祝您身体健康',
  },
  {
    key: 'special_char',
    name: '特殊字符过滤',
    desc: '移除原文中特殊字符占比过高的段落。',
    hasThreshold: true,
    preview_before: '53AI提供企业专属© ® © 大模型开发工具链',
    preview_after: '53AI提供企业专属大模型开发工具链',
  },
  {
    key: 'pronoun_replace',
    name: '代词替换',
    desc: '将原文中的代词替换为指定的实际内容。',
    preview_before: '它能够提供多种高级特性，<span class="text-[#2563EB]">它</span>可以帮助你提升团队效率。',
    preview_after: '能提供多种高级特性，它可以帮助你提升团队效率。',
  },
]

export function CleanConfig({ config, onChange }: CleanConfigProps) {
  // 从 config 中读取规则状态
  const cleanRules = useMemo<CleanRule[]>(() => {
    return DEFAULT_RULES.map(rule => {
      const configKey = RULE_CONFIG_MAP[rule.key]
      let enabled = false
      if (configKey === 'special_char_filter') {
        enabled = config?.special_char_filter?.enabled ?? true
      } else {
        enabled = config?.[configKey] ?? (rule.key === 'pronoun_replace' ? false : true)
      }
      return { ...rule, enabled }
    })
  }, [config])

  const handleRuleChange = useCallback((key: string, enabled: boolean) => {
    const configKey = RULE_CONFIG_MAP[key]
    if (configKey === 'special_char_filter') {
      onChange?.({
        ...config,
        special_char_filter: {
          ...(config?.special_char_filter || {}),
          enabled,
        },
      })
    } else {
      onChange?.({ ...config, [configKey]: enabled })
    }
  }, [config, onChange])

  const updateConfig = useCallback((key: string, value: any) => {
    onChange?.({ ...config, [key]: value })
  }, [config, onChange])

  return (
    <div className="clean-config-container space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50">
            <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase font-bold">
              <th className="px-6 py-3">动作</th>
              <th className="px-6 py-3">效果预览(处理前)</th>
              <th className="px-6 py-3">效果预览(处理后)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {cleanRules.map(rule => (
              <tr key={rule.name} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-5 align-top">
                  <div className="flex gap-3">
                    <Checkbox
                      checked={rule.enabled}
                      onChange={e => handleRuleChange(rule.key, e.target.checked)}
                      className="mt-1"
                    />
                    <div>
                      <div className="font-bold text-gray-800 mb-1">{rule.name}</div>
                      <p className="text-xs text-gray-400 leading-relaxed max-w-[200px]">{rule.desc}</p>

                      {/* Special handling for rules with thresholds */}
                      {rule.hasThreshold && (
                        <div className="mt-4 flex items-center gap-3">
                          <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#2563EB]"
                              style={{
                                width:
                                  (rule.key === 'special_char'
                                    ? (config.special_char_threshold || 0.5) * 100
                                    : config.short_text_threshold || 50) + '%',
                              }}
                            />
                          </div>
                          <span className="text-[10px] font-bold text-[#2563EB]">
                            {rule.key === 'special_char'
                              ? (config.special_char_threshold || 0.5)
                              : (config.short_text_threshold || 50)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-5 align-top">
                  <div className="bg-gray-50 p-3 rounded-lg text-xs font-mono text-gray-400 border border-gray-100 h-24 overflow-hidden">
                    <div dangerouslySetInnerHTML={{ __html: rule.preview_before }} />
                  </div>
                </td>
                <td className="px-6 py-5 align-top">
                  <div className="bg-white p-3 rounded-lg text-xs font-mono text-gray-600 border border-gray-100 h-24 overflow-hidden shadow-sm">
                    <div dangerouslySetInnerHTML={{ __html: rule.preview_after }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Interactive Sliders for the thresholds */}
      <div className="bg-gray-50/50 rounded-2xl p-6 border border-gray-100 space-y-8 mt-8">
        <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
          <SvgIcon name="tool" className="text-[#2563EB]" />
          <span>清洗阈值精调</span>
        </div>

        <div className="grid grid-cols-2 gap-12">
          <div className="space-y-3">
            <div className="flex justify-between">
              <label className="text-xs font-bold text-gray-400 uppercase">特殊字符占比阈值</label>
              <span className="text-xs font-mono text-[#2563EB]">
                {config.special_char_threshold || 0.5}
              </span>
            </div>
            <Slider
              value={(config.special_char_threshold || 0.5) * 100}
              onChange={val => updateConfig('special_char_threshold', val / 100)}
              min={0}
              max={100}
              tooltip={{ formatter: val => (val! / 100).toFixed(2) }}
            />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between">
              <label className="text-xs font-bold text-gray-400 uppercase">短文本长度阈值</label>
              <span className="text-xs font-mono text-[#2563EB]">
                {config.short_text_threshold || 50}
              </span>
            </div>
            <Slider
              value={config.short_text_threshold || 50}
              onChange={val => updateConfig('short_text_threshold', val)}
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
