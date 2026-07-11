import { Switch } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { usePipelineTranslation } from '../../context'

export interface SummaryConfigData {
  summary_faq?: { enabled: boolean }
  entity_extraction?: { enabled: boolean }
  knowledge_map?: { enabled: boolean }
}

export interface SummaryConfigProps {
  config: SummaryConfigData
  onChange: (config: SummaryConfigData) => void
  i18nPrefix?: string
}

interface SummaryItem {
  key: keyof SummaryConfigData
  nameKey: string
  descKey: string
  icon: string
  color: string
  bgColor: string
}

const getSummaryItems = (): SummaryItem[] => [
  {
    key: 'summary_faq',
    nameKey: 'summary_doc_summary',
    descKey: 'summary_doc_summary_desc',
    icon: 'doc-detail',
    color: '#2563EB',
    bgColor: '#EBF1FF',
  },
  {
    key: 'entity_extraction',
    nameKey: 'summary_doc_tag',
    descKey: 'summary_doc_tag_desc',
    icon: 'tag-one',
    color: '#EE7702',
    bgColor: '#FFF5EB',
  },
  {
    key: 'knowledge_map',
    nameKey: 'summary_knowledge_map',
    descKey: 'summary_knowledge_map_desc',
    icon: 'circle-five-line',
    color: '#8063E3',
    bgColor: '#F1EDFF',
  },
]

export function SummaryConfig({ config, onChange, i18nPrefix = 'data_pipeline' }: SummaryConfigProps) {
  const { t } = usePipelineTranslation()
  const tKey = (key: string) => `${i18nPrefix}.${key}`
  const items = getSummaryItems()

  const updateConfig = (patch: Partial<SummaryConfigData>) => {
    onChange({ ...config, ...patch })
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="space-y-4">
        {items.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between p-5 rounded-xl hover:shadow-md transition-all group"
            style={{
              backgroundColor: config[item.key]?.enabled ? '#F5F9FF' : 'white',
            }}
          >
            <div className="flex items-center gap-4">
              <div
                className="size-12 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform"
                style={{ color: item.color, backgroundColor: item.bgColor }}
              >
                <SvgIcon name={item.icon} size={24} />
              </div>
              <div>
                <div className="text-sm font-bold text-gray-800">
                  {t(tKey(item.nameKey))}
                </div>
                <div className="text-xs text-gray-400 mt-1 max-w-md leading-relaxed">
                  {t(tKey(item.descKey))}
                </div>
              </div>
            </div>
            <Switch
              checked={config[item.key]?.enabled}
              onChange={(checked) => {
                if (config[item.key]) {
                  updateConfig({
                    [item.key]: {
                      ...config[item.key],
                      enabled: checked,
                    },
                  })
                }
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default SummaryConfig
