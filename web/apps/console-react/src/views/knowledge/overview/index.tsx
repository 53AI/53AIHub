import { t } from '@/locales'

export function KnowledgeOverview() {
  

  return (
    <div className="p-6">
      <div className="text-sm text-secondary">
        {t('knowledge.overview_desc')}
      </div>
    </div>
  )
}

export default KnowledgeOverview