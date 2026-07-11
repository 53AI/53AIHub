import { RightOutlined } from '@ant-design/icons'

interface RagStats {
  type?: string
  files_search?: Array<{ file_id: string; file_name: string }>
  library_search?: Array<{ library_id: string; library_name: string }>
}

interface RagHeaderProps {
  ragStats?: RagStats | null
  loading?: boolean
  ragSearchText?: string
  specifiedContent?: string
  showLibraryCount?: boolean
  onOpenKnow?: () => void
}

export function RagHeader({
  ragStats,
  loading = false,
  ragSearchText,
  specifiedContent,
  showLibraryCount = true,
  onOpenKnow,
}: RagHeaderProps) {
  const handleOpenKnow = () => {
    if (!showLibraryCount) return
    onOpenKnow?.()
  }

  // RAG statistics display
  if (ragStats) {
    if (ragStats.type === 'web_search') {
      return (
        <div
          className="h-8 px-2 rounded-lg cursor-pointer bg-[#F4F5F7] hover:bg-[#E1E2E3] inline-flex items-center mb-3"
          onClick={handleOpenKnow}
        >
          <p className="text-sm text-[#1D1E1F]">
            搜索到{ragStats.files_search?.length || 0}篇网络资料
          </p>
          <RightOutlined className="text-[#939499]" />
        </div>
      )
    }

    return (
      <div
        className="h-8 px-2 rounded-lg cursor-pointer bg-[#F4F5F7] hover:bg-[#E1E2E3] inline-flex items-center mb-3"
        onClick={handleOpenKnow}
      >
        <p className="text-sm text-[#1D1E1F]">
          {showLibraryCount ? (
            <>
              搜索到{ragStats.library_search?.length || 0}个知识库
              {ragStats.files_search?.length || 0}篇资料
            </>
          ) : (
            '已完成对文档的搜索'
          )}
        </p>
        {showLibraryCount && <RightOutlined className="text-[#939499]" />}
      </div>
    )
  }

  // Loading state
  if (loading && ragSearchText) {
    return (
      <div className="h-8 px-2 rounded-lg cursor-pointer bg-[#F4F5F7] hover:bg-[#E1E2E3] inline-flex items-center mb-3">
        <p className="flex-1 text-sm text-[#1D1E1F] truncate">{ragSearchText}</p>
      </div>
    )
  }

  // Specified content
  if (specifiedContent) {
    return (
      <div className="h-8 px-2 rounded-lg cursor-pointer bg-[#F4F5F7] hover:bg-[#E1E2E3] inline-flex items-center mb-3">
        <p className="flex-1 text-sm text-[#1D1E1F] truncate">已分析指定知识</p>
      </div>
    )
  }

  return null
}

export default RagHeader
