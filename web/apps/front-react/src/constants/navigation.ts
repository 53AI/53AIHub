export const NAVIGATION_TYPE = {
  SYSTEM: 1,
  EXTERNAL: 2,
  CUSTOM: 3,
} as const
export type NavigationType = (typeof NAVIGATION_TYPE)[keyof typeof NAVIGATION_TYPE]

export const NAVIGATION_TARGET = {
  SELF: 1,
  BLANK: 2,
} as const
export type NavigationTarget = (typeof NAVIGATION_TARGET)[keyof typeof NAVIGATION_TARGET]

/** 是否包含 KM 功能，与 .env 中 VITE_INCLUDE_KM 一致 */
export const includeKm = import.meta.env.VITE_INCLUDE_KM === 'true'

// Image host will be configured via environment
const img_host = import.meta.env.VITE_GLOB_API_HOST || ''

export const INIT_DATA_LIST = [
  {
    jump_path: '/index',
    name: '首页',
    sort: 9999,
    icon: `${img_host}/navigation/icon34.png`,
    config: JSON.stringify({
      target: NAVIGATION_TARGET.SELF,
      seo_title: '',
      seo_keywords: '',
      seo_description: '',
    }),
    status: 1,
  },
  ...(includeKm
    ? [
        {
          jump_path: '/knowledge',
          name: '知识库',
          sort: 9998,
          icon: `${img_host}/navigation/icon5.png`,
          config: JSON.stringify({
            target: NAVIGATION_TARGET.SELF,
            seo_title: '',
            seo_keywords: '',
            seo_description: '',
          }),
          status: 1,
        },
      ]
    : []),
  {
    jump_path: '/agent',
    name: '智能体',
    sort: 9997,
    icon: `${img_host}/navigation/icon33.png`,
    config: JSON.stringify({
      target: NAVIGATION_TARGET.SELF,
      seo_title: '',
      seo_keywords: '',
      seo_description: '',
    }),
    status: 1,
  },
  {
    jump_path: '/prompt',
    name: '提示词',
    sort: 9996,
    icon: `${img_host}/navigation/icon32.png`,
    config: JSON.stringify({
      target: NAVIGATION_TARGET.SELF,
      seo_title: '',
      seo_keywords: '',
      seo_description: '',
    }),
    status: 1,
  },
  {
    jump_path: '/toolkit',
    name: 'AI工具',
    sort: 9995,
    icon: `${img_host}/navigation/icon10.png`,
    config: JSON.stringify({
      target: NAVIGATION_TARGET.SELF,
      seo_title: '',
      seo_keywords: '',
      seo_description: '',
    }),
    status: 1,
  },
  {
    jump_path: '/skills',
    name: '技能库',
    sort: 9997,
    icon: `${img_host}/icon/icon35.png`,
    config: JSON.stringify({
      target: NAVIGATION_TARGET.SELF,
      seo_title: '',
      seo_keywords: '',
      seo_description: '',
    }),
    status: 1,
  },
]
