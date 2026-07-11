import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { UpOutlined, RightOutlined, LinkOutlined } from '@ant-design/icons'

interface QuotationProps {
  files: Array<{
    file_id: string | number
    file_name: string
    file_path?: string
    file_icon?: string
    library_id?: string | number
    source_key?: string
    source?: string
  }>
}

export function Quotation({ files = []}: QuotationProps) {
  const [showFiles, setShowFiles] = useState(false)

  const getIndex = (item, sourceKey?: string) => {
    const match = (sourceKey || '').replace('[Source:', '').replace(']', '').split('-')
    const index = item.chunk_type === 'web_search' ? match[1] : match[0]
    return Number(index) > -1 ? index : ''
  }

  const fileList = useMemo(() => {
    const list = files.map(item => ({
      ...item,
      index: getIndex(item, item.source_key)
    }))
    return list.sort((a, b) => (a.index as number) - (b.index as number))
  }, [files])

  if (!files.length) return null

  return (
    <>
      <div
        className="h-8 px-2 rounded-lg cursor-pointer bg-[#F4F5F7] hover:bg-[#E1E2E3] inline-flex items-center mt-3"
        onClick={() => setShowFiles(!showFiles)}
      >
        <p className="text-sm text-[#1D1E1F]">引用 {fileList.length} 篇资料作为参考</p>
        {showFiles ? (
          <UpOutlined className="text-[#939499]" />
        ) : (
          <RightOutlined className="text-[#939499]" />
        )}
      </div>
      {showFiles && (
        <div className="space-y-1.5 mt-3">
          { (
            fileList.map((item, index) => item.chunk_type === 'web_search' ?  (
              <a
                key={item.file_id}
                href={item.file_path}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                <div className="size-4 rounded-full bg-[#EDEDED] flex items-center justify-center text-xs text-[#4F5052]">
                  {item.source_key || item.source
                    ? getIndex(item, item.source_key || item.source)
                    : index + 1}
                </div>
                <LinkOutlined className="text-[#939499]" />
                <div className="flex-1 text-sm text-[#1D1E1F] truncate">
                  {item.file_name}
                </div>
              </a>
            ) : (<Link
                key={item.file_id}
                to={`/library/${item.library_id}/file/${item.file_id}`}
                target="_blank"
                className="flex items-center gap-2"
              >
                <div className="size-4 rounded-full bg-[#EDEDED] flex items-center justify-center text-xs text-[#4F5052]">
                  {item.source_key || item.source
                    ? getIndex(item, item.source_key || item.source)
                    : index + 1}
                </div>
                <img src={item.file_icon} className="size-5" alt="" />
                <div className="flex-1 text-sm text-[#1D1E1F] truncate">
                  {item.file_name}
                </div>
              </Link>
            ))
          )}
        </div>
      )}
    </>
  )
}

export default Quotation
