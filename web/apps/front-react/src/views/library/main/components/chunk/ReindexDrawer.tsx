import { useState, useRef, forwardRef, useImperativeHandle, useCallback } from 'react'
import { Drawer, Button, Radio, Empty, Spin, message } from 'antd'
import { Dropdown } from '@km/shared-components-react'
import { DownOutlined } from '@ant-design/icons'
import { SvgIcon } from '@km/shared-components-react'
import ChunkConfig from './Config'
import chunkSettingApi from '@/api/modules/chunk-setting'
import chunksApi from '@/api/modules/chunks'
import { REINDEX_TYPE } from '@/constants/chunk'
import { t } from '@/locales'
import { getPublicPath, getRealPath } from '@/utils/config'
import './edit-drawer.css'

interface FileItem {
  id: string
  name: string
  extension: string
  icon: string
  file_ext: string
  file_mime: string
}

interface ReindexDrawerProps {
  file: FileItem
  onReindex: () => void
}

export interface ReindexDrawerRef {
  open: () => Promise<void>
}

const numberToIndex = (num: number): string => {
  const indices = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  return indices[num - 1] || String(num)
}

const ReindexDrawer = forwardRef<ReindexDrawerRef, ReindexDrawerProps>(({ file, onReindex }, ref) => {
  const chunkConfigRef = useRef<any>(null)

  const [visible, setVisible] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [reindexLoading, setReindexLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [mode, setMode] = useState<string>(REINDEX_TYPE.CHUNK)
  const [chunkSettingList, setChunkSettingList] = useState<any[]>([])
  const [currentSetting, setCurrentSetting] = useState<any>(null)
  const [previewList, setPreviewList] = useState<any[]>([])

  const handleChunkSetting = useCallback((item: any) => {
    setCurrentSetting(item)
    setTimeout(() => {
      chunkConfigRef.current?.setChunkConfig(item)
    }, 0)
  }, [])

  const handlePreview = useCallback(async () => {
    setPreviewLoading(true)
    try {
      const params: any = {
        file_id: file.id
      }
      const config = chunkConfigRef.current?.getChunkConfig()

      if (config) {
        params.chunking_config = config.chunking_config
      } else if (currentSetting) {
        params.config_id = currentSetting.id
        params.chunking_config = currentSetting.chunking_config
      }

      const res = await chunksApi.preview(params)
      const list = (res.chunks || []).map((item: any) => {
        item.content = item.content.length > 500 ? item.content.slice(0, 500) + '...' : item.content
        return item
      }).slice(0, 30)
      setPreviewList(list)
    } finally {
      setPreviewLoading(false)
    }
  }, [file.id, currentSetting])

  const handleConfirm = useCallback(async () => {
    let config = chunkConfigRef.current?.getChunkConfig()
    if (!config && currentSetting) {
      config = {
        chunking_config: currentSetting.chunking_config
      }
    }

    if (!config) return

    setReindexLoading(true)
    try {
      await chunkSettingApi.config.document.update(file.id, config)
      await chunksApi.reindex({ file_id: file.id, mode })
      onReindex()
      setVisible(false)
      message.success(t('status.save_success'))
    } catch (error) {
      message.error(t('status.save_fail'))
    } finally {
      setReindexLoading(false)
    }
  }, [file.id, mode, currentSetting, onReindex, t])

  const loadChunkSetting = useCallback(async () => {
    const list = await chunkSettingApi.list()
    setChunkSettingList(list)
    if (list.length > 0) {
      handleChunkSetting(list[0])
    }
  }, [handleChunkSetting])

  useImperativeHandle(ref, () => ({
    open: async () => {
      setVisible(true)
      setIsLoading(true)
      await loadChunkSetting()
      await handlePreview()
      setIsLoading(false)
    }
  }), [loadChunkSetting, handlePreview])

  // Get description for chunking config type
  const getConfigDescription = (type: string): string => {
    switch (type) {
      case 'default':
        return '根据智能算法进行分段计算及数据清洗'
      case 'data_table':
        return '识别表格结构与数据逻辑，自动对表格类文档进行分段计算与数据清洗'
      case 'qa':
        return '聚焦问答类文档的问答结构，清晰拆分问题与答案'
      default:
        return '根据智能算法进行分段计算及数据清洗'
    }
  }

  return (
    <Drawer
      open={visible}
      onClose={() => setVisible(false)}
      title={t('chunk.reindex')}
      styles={{ wrapper: { width: 1400 }, body: { padding: 0 } }}
      className="chunk-reindex-drawer"
    >
      <Spin spinning={isLoading}>
        <div className="h-full overflow-hidden flex">
          <div className="flex-1 py-5 overflow-hidden flex flex-col">
            <div className="flex-1 px-4 overflow-y-auto">
              {/* Mode Selection */}
              <div className="flex gap-3 mb-5">
                <div
                  className={`flex-1 p-4 border rounded cursor-pointer ${
                    mode === REINDEX_TYPE.CHUNK ? 'border-[#2563EB] bg-[#F5F8FE]' : 'border-[#E6E8EB]'
                  }`}
                  onClick={() => setMode(REINDEX_TYPE.CHUNK)}
                >
                  <div className="flex items-center gap-2">
                    <img className="size-4" src={getPublicPath('/images/chunk/reindex_chunk.png')} alt="" />
                    <h4 className="flex-1 text-sm text-[#1D1E1F] font-semibold">{t('chunk.reindex_type_all')}</h4>
                    <Radio checked={mode === REINDEX_TYPE.CHUNK} />
                  </div>
                  <p className="text-xs text-[#9A9A9A] whitespace-nowrap">重新生成知识点及索引块，并将索引块向量化</p>
                </div>
                <div
                  className={`flex-1 p-4 border rounded cursor-pointer ${
                    mode === REINDEX_TYPE.RETRIEVAL ? 'border-[#2563EB] bg-[#F5F8FE]' : 'border-[#E6E8EB]'
                  }`}
                  onClick={() => setMode(REINDEX_TYPE.RETRIEVAL)}
                >
                  <div className="flex items-center gap-2">
                    <img className="size-4" src={getPublicPath('/images/chunk/onlyindex.png')} alt="" />
                    <h4 className="flex-1 text-sm text-[#1D1E1F] font-semibold">{t('chunk.reindex_type_part')}</h4>
                    <Radio checked={mode === REINDEX_TYPE.RETRIEVAL} />
                  </div>
                  <p className="text-xs text-[#9A9A9A] whitespace-nowrap">不修改知识点与索引块，将索引块重新向量化</p>
                </div>
              </div>

              {/* Config Section - hidden for RETRIEVAL mode */}
              <div hidden={mode === REINDEX_TYPE.RETRIEVAL}>
                <div className="text-sm text-[#4F5052]">拆分策略</div>
                {currentSetting && (
                  <div className="p-4 border rounded mt-2">
                    <div className={`flex items-center gap-2 ${currentSetting.chunking_config?.type === 'default' ? 'border-b pb-5 mb-3' : ''}`}>
                      <img
                        className="size-10"
                        src={getRealPath({ url: `/images/split/${currentSetting.chunking_config.type}.png` })}
                        alt=""
                      />
                      <div className="flex-1">
                        <div className="text-sm text-[#1D1E1F] font-semibold">
                          {currentSetting.chunking_config.name}
                        </div>
                        <div className="text-xs text-[#9A9A9A] mt-1">
                          {getConfigDescription(currentSetting.chunking_config.type)}
                        </div>
                      </div>
                      {/* Show switch dropdown for xls files */}
                      {file.file_mime === 'xls' && (
                        <Dropdown
                          trigger={['click']}
                          placement="bottomLeft"
                          menu={{
                            items: chunkSettingList.map(item => ({
                              key: item.id,
                              label: item.chunking_config.name,
                              onClick: () => handleChunkSetting(item)
                            }))
                          }}
                        >
                          <div className="flex items-center gap-1 cursor-pointer">
                            <span className="text-sm text-[#1D1E1F]">切换</span>
                            <DownOutlined style={{ fontSize: 12 }} />
                          </div>
                        </Dropdown>
                      )}
                    </div>
                    {currentSetting.chunking_config.type === 'default' && (
                      <ChunkConfig ref={chunkConfigRef} />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex-none px-4">
              <Button
                type="primary"
                loading={reindexLoading}
                className="mt-4"
                onClick={handleConfirm}
              >
                {mode === REINDEX_TYPE.CHUNK ? '保存并处理' : '确定'}
              </Button>
              <Button className="mt-4 ml-2" onClick={handlePreview}>
                预览
              </Button>
            </div>
          </div>

          {/* Preview Panel */}
          <Spin spinning={previewLoading}>
            <div className="flex-1 border-l py-6 flex flex-col overflow-hidden">
              <div className="flex-none pb-4 px-4">
                <div className="flex items-center text-base text-regular font-semibold">内容预览</div>
                <div className="flex items-center gap-1 mt-3">
                  <img className="w-4 h-4" src={file.icon} alt="" />
                  <span className="text-regular text-sm truncate">{file.name}</span>
                </div>
              </div>
              <div className="flex-1 px-4 overflow-y-auto">
                {previewList.length === 0 ? (
                  <Empty
                    description="暂无内容"
                    image={getPublicPath('/images/empty.png')}
                    styles={{ image: { height: 100 } }}
                  />
                ) : (
                  previewList.map((item, index) => (
                    <div
                      key={index}
                      className={`px-4 py-3 rounded bg-[#182B50] bg-opacity-5 ${index === 0 ? 'mt-0' : 'mt-4'}`}
                    >
                      <div className="flex justify-between">
                        <div className="text-xs text-regular text-opacity-60">
                          #{numberToIndex(item.index)}
                          {item.child_chunks && ` | ${item.child_chunks.length} 检索块`}
                        </div>
                        <div className="text-xs text-regular text-opacity-60">
                          A {item.token_count} 字符
                        </div>
                      </div>
                      {item.question ? (
                        <>
                          <div className="flex gap-2 mt-2">
                            <div className="h-5 rounded-sm px-1 flex items-center justify-center text-xs text-[#2563EB] bg-[#E8EDF9] whitespace-nowrap">
                              问题
                            </div>
                            <div className="text-sm text-regular">{item.question}</div>
                          </div>
                          <div className="flex gap-2 mt-1">
                            <div className="h-5 rounded-sm px-1 flex items-center justify-center text-xs text-[#07C160] bg-[#E6F5EE] whitespace-nowrap">
                              答案
                            </div>
                            <div className="text-sm text-regular">{item.answer}</div>
                          </div>
                        </>
                      ) : item.retrieval_chunks ? (
                        <div className="text-sm leading-7 break-words mt-2">
                          {item.retrieval_chunks.map((chunk: any, cIndex: number) => (
                            <span
                              key={cIndex}
                              className="px-1 py-0.5 bg-white text-[#182B50CC] mr-1 border-r-2 border-r-transparent cursor-pointer hover:bg-[#FEE7D5] hover:border-r-[#EEA205]"
                              title={`检索块-${cIndex + 1}·${chunk.token_count}个字符`}
                            >
                              {chunk.content}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-regular mt-2">{item.content}</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </Spin>
        </div>
      </Spin>
    </Drawer>
  )
})

ReindexDrawer.displayName = 'ReindexDrawer'

export default ReindexDrawer
