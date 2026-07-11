import { Checkbox } from 'antd'
import { CloseOutlined, LinkOutlined } from '@ant-design/icons'
import { t } from '@/locales'

interface ShareHeaderProps {
  showRecommend?: boolean
  selectAll: boolean
  selectMessageIds: Array<string | number>
  customClass?: string
  onSelectAll: () => void
  onCreateShare: () => void
  onOpenShare: () => void
}

export function ShareHeader({
  showRecommend = false,
  selectAll,
  selectMessageIds,
  customClass = '',
  onSelectAll,
  onCreateShare,
  onOpenShare,
}: ShareHeaderProps) {
  return (
    <header
      className={`flex-none sticky top-0 z-10 bg-white ${showRecommend ? 'w-2/3' : 'border-b'}`}
    >
      <div
        className={`h-[70px] flex items-center justify-between ${showRecommend ? 'w-[95%]' : customClass || 'w-11/12 lg:w-4/5 max-w-[800px] mx-auto'}`}
      >
        <Checkbox
          checked={selectAll}
          onClick={onSelectAll}
        >
          {selectAll ? t('action.unselect_all') : t('action.select_all')}
        </Checkbox>
        <div className="flex items-center gap-2">
          {selectMessageIds.length > 0 && (
            <div
              className="h-8 flex items-center gap-1 px-2 rounded-md bg-[#F5F5F7] cursor-pointer hover:bg-[#E1E2E3] text-[#2563EB]"
              onClick={onCreateShare}
            >
              <LinkOutlined style={{ fontSize: 16 }} />
              <span className="text-sm">{t('action.copy_link')}</span>
            </div>
          )}
          <div
            className="size-8 flex items-center justify-center rounded-md bg-[#F5F5F7] cursor-pointer hover:bg-[#E1E2E3]"
            onClick={() => onOpenShare()}
          >
            <CloseOutlined />
          </div>
        </div>
      </div>
    </header>
  )
}

export default ShareHeader
