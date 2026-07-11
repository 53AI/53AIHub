import React, { useCallback } from 'react'
import { Switch } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import './SummaryConfig.css'

interface SummaryConfigProps {
  config: any
  onChange?: (config: any) => void
}

const summaryItems = [
  {
    key: 'summary_faq',
    name: '文档摘要',
    desc: '提取文档的核心主题、关键内容点与核心内容，快速理解文档核心思想',
    icon: 'doc-detail',
    color: '#2563EB',
    bgColor: '#EBF1FF',
  },
  {
    key: 'entity_extraction',
    name: '文档标签',
    desc: '基于文档的核心内容与重点信息，生成文档标签',
    icon: 'tag-one',
    color: '#EE7702',
    bgColor: '#FFF5EB',
  },
  {
    key: 'knowledge_map',
    name: '知识地图',
    desc: '梳理文档内的逻辑框架与信息关联，生成可视化的内容结构与知识关联图谱',
    icon: 'circle-five-line',
    color: '#8063E3',
    bgColor: '#F1EDFF',
  },
]

export function SummaryConfig({ config, onChange }: SummaryConfigProps) {
  const handleToggle = useCallback((key: string, checked: boolean) => {
    const newConfig = { ...config }
    if (newConfig[key]) {
      newConfig[key] = { ...newConfig[key], enabled: checked }
    } else {
      newConfig[key] = { enabled: checked }
    }
    onChange?.(newConfig)
  }, [config, onChange])

  return (
    <div className="summary-config-container space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="space-y-4">
        {summaryItems.map(item => (
          <div
            key={item.key}
            className={`flex items-center justify-between p-5 rounded-xl hover:shadow-md transition-all group ${
              config[item.key]?.enabled ? 'bg-[#F5F9FF]' : 'bg-white'
            }`}
          >
            <div className="flex items-center gap-4">
              <div
                className="size-12 rounded-xl bg-blue-50 flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform"
                style={{ color: item.color, backgroundColor: item.bgColor }}
              >
                <SvgIcon name={item.icon} size={24} />
              </div>
              <div>
                <div className="text-sm font-bold text-gray-800">{item.name}</div>
                <div className="text-xs text-gray-400 mt-1 max-w-md leading-relaxed">{item.desc}</div>
              </div>
            </div>
            <Switch
              checked={config[item.key]?.enabled}
              onChange={checked => handleToggle(item.key, checked)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default SummaryConfig
