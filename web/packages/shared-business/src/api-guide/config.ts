import type { ApiGuideContentItem } from './types'

type ApiGuideStepConfig = {
  /** 抽屉标题 */
  title: string
  /** 图文步骤 */
  content: ApiGuideContentItem[]
}

/** 53AI Studio 接入步骤（两端一致，静态资源在各应用 public/images 下维护） */
export const API_GUIDE_STUDIO: ApiGuideStepConfig = {
  title: '53AI Studio',
  content: [
    {
      type: 'text',
      content:
        '第一步：登录53AI Studio（<a href="https://chat.53ai.com/#/login" style="color: #576D9C;" target="_blank">https://chat.53ai.com/#/login</a>），在「私有数据」下，点击创建/从53AI KM里导入',
    },
    { type: 'image', content: '/images/library/studio_help_1.png' },
    {
      type: 'text',
      content:
        '第二步：复制本知识库的相关参数填入，点击下一步，配置基本信息确定即可',
    },
    { type: 'image', content: '/images/library/studio_help_2.png' },
    { type: 'image', content: '/images/library/studio_help_3.png' },
  ],
}

/** Dify 接入步骤（两端一致） */
export const API_GUIDE_DIFY: ApiGuideStepConfig = {
  title: 'Dify',
  content: [
    {
      type: 'text',
      content:
        '第一步：登录Dify官网（<a href="https://cloud.dify.ai/" style="color: #576D9C;" target="_blank">https://cloud.dify.ai/</a>），在「知识库」下，点击连接外部知识库',
    },
    { type: 'image', content: '/images/library/dify_help_1.png' },
    {
      type: 'text',
      content:
        '第二步：在「外部知识库API」下，点击创建新的外部知识库API，复制本知识库的相关参数填入后连接',
    },
    { type: 'image', content: '/images/library/dify_help_2.png' },
    { type: 'image', content: '/images/library/dify_help_3.png' },
    {
      type: 'text',
      content: '第三步：复制填入填外部知识库ID，点击连接即创建外部知识库成功',
    },
    { type: 'image', content: '/images/library/dify_help_4.png' },
    { type: 'image', content: '/images/library/dify_help_5.png' },
  ],
}
