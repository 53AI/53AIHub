import { useState } from 'react'
import { ApiOutlined, ArrowRightOutlined } from '@ant-design/icons'
import { Button, Drawer } from 'antd'
import { MdRenderer } from '@km/hub-ui-x-react'
import { SafeImage } from '@km/shared-components-react'
import { API_GUIDE_DIFY, API_GUIDE_STUDIO } from './config'
import type { ApiGuideType } from './types'

export interface ApiGuideLabels {
  /** 接入53AI Studio 按钮文案 */
  studio: string
  /** 接入Dify 按钮文案 */
  dify: string
  /** Wiki API文档 按钮文案 */
  wiki: string
}

export interface ApiGuideProps {
  /** 三个按钮的文案（各端自行 i18n 或硬编码） */
  labels: ApiGuideLabels
  /** Wiki 指引抽屉标题（前台为知识库级、后台为空间级，文案不同） */
  wikiTitle: string
  /** Wiki 指引 Markdown 内容（作用域不同，由调用方提供） */
  wikiContent: string
  /** 抽屉 zIndex（嵌套在其他抽屉内时需调高，如后台空间设置抽屉） */
  zIndex?: number
}

/**
 * 开放接口「接入指引」：三个入口按钮 + 指引抽屉
 *
 * Studio / Dify 的图文步骤两端一致，内置在模块中；
 * Wiki 指引与作用域强相关（前台=知识库级、后台=空间级），由调用方注入。
 */
export function ApiGuide({
  labels,
  wikiTitle,
  wikiContent,
  zIndex,
}: ApiGuideProps) {
  const [open, setOpen] = useState(false)
  const [guideType, setGuideType] = useState<ApiGuideType>('dify')

  const handleSelect = (type: ApiGuideType) => {
    setGuideType(type)
    setOpen(true)
  }

  const activeGuide = guideType === 'studio' ? API_GUIDE_STUDIO : API_GUIDE_DIFY
  const drawerTitle = guideType === 'wiki' ? wikiTitle : activeGuide.title

  return (
    <>
      <div className="flex flex-wrap gap-4">
        <Button onClick={() => handleSelect('studio')}>
          <SafeImage
            className="size-6"
            src="/images/external/studio.png"
            alt="studio"
          />
          <span className="px-2">{labels.studio}</span>
          <ArrowRightOutlined />
        </Button>
        <Button onClick={() => handleSelect('dify')}>
          <SafeImage
            className="size-6"
            src="/images/external/dify.png"
            alt="dify"
          />
          <span className="px-2">{labels.dify}</span>
          <ArrowRightOutlined />
        </Button>
        <Button onClick={() => handleSelect('wiki')}>
          <ApiOutlined className="text-[#576D9C]" />
          <span className="px-2">{labels.wiki}</span>
          <ArrowRightOutlined />
        </Button>
      </div>

      <Drawer
        open={open}
        title={drawerTitle}
        styles={{ wrapper: { width: 864 } }}
        zIndex={zIndex}
        onClose={() => setOpen(false)}
      >
        {guideType === 'wiki' ? (
          <MdRenderer content={wikiContent} />
        ) : (
          activeGuide.content.map((item, index) => (
            <div key={index}>
              {item.type === 'text' && (
                <p
                  className="text-sm text-[#1D1E1F] my-2"
                  dangerouslySetInnerHTML={{ __html: item.content }}
                />
              )}
              {item.type === 'image' && (
                <div className="flex justify-center my-2">
                  <SafeImage
                    src={item.content}
                    className="w-full"
                    alt=""
                  />
                </div>
              )}
            </div>
          ))
        )}
      </Drawer>
    </>
  )
}

export default ApiGuide
