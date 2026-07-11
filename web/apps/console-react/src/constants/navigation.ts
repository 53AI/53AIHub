import { img_host } from '@/utils/config'
/**
 * 导航类型枚举
 */
export const NAVIGATION_TYPE = {
  /** 系统导航 */
  SYSTEM: 1,
  /** 外部链接 */
  EXTERNAL: 2,
  /** 自定义页面 */
  CUSTOM: 3,
} as const

export type NavigationType = (typeof NAVIGATION_TYPE)[keyof typeof NAVIGATION_TYPE]

/**
 * 导航打开方式枚举
 */
export const NAVIGATION_TARGET = {
  /** 当前窗口打开 */
  SELF: 1,
  /** 新窗口打开 */
  BLANK: 2,
} as const

export type NavigationTarget = (typeof NAVIGATION_TARGET)[keyof typeof NAVIGATION_TARGET]

/**
 * 导航类型标签映射
 */
export const NAVIGATION_TYPE_LABEL_MAP = new Map<NavigationType, string>([
  [NAVIGATION_TYPE.SYSTEM, 'navigation.type.system'],
  [NAVIGATION_TYPE.EXTERNAL, 'navigation.type.external'],
  [NAVIGATION_TYPE.CUSTOM, 'navigation.type.custom'],
])

/**
 * 导航打开方式标签映射
 */
export const NAVIGATION_TARGET_LABEL_MAP = new Map<NavigationTarget, string>([
  [NAVIGATION_TARGET.SELF, 'navigation.target.self'],
  [NAVIGATION_TARGET.BLANK, 'navigation.target.blank'],
])

/**
 * 默认导航配置
 */
const createDefaultConfig = () =>
  JSON.stringify({
    target: NAVIGATION_TARGET.SELF,
    seo_title: '',
    seo_keywords: '',
    seo_description: '',
  })

/** KM 知识库导航项，由 VITE_INCLUDE_KM 控制是否包含 */
const NAV_KM_ITEM = {
  jump_path: '/knowledge',
  name: '知识库',
  sort: 9998,
  icon: `${img_host}/icon/icon5.png`,
  config: createDefaultConfig(),
}

/**
 * 默认初始化数据（根据 VITE_INCLUDE_KM 决定是否包含知识库）
 */

export const NAVIGATION_INIT_DATA = () => {
  return [
    {
      jump_path: '/index',
      name: '首页',
      sort: 9999,
      icon: `${img_host}/icon/icon34.png`,
      config: createDefaultConfig(),
    },
    ...(window.$vars?.includeKm ? [NAV_KM_ITEM] : []),
    {
      jump_path: '/agent',
      name: '智能体',
      sort: 9997,
      icon: `${img_host}/icon/icon33.png`,
      config: createDefaultConfig(),
    },
    {
      jump_path: '/prompt',
      name: '提示词',
      sort: 9996,
      icon: `${img_host}/icon/icon32.png`,
      config: createDefaultConfig(),
    },
    {
      jump_path: '/toolkit',
      name: 'AI工具',
      sort: 9996,
      icon: `${img_host}/navigation/icon10.png`,
      config: createDefaultConfig(),
    },
    {
      jump_path: '/skills',
      name: '技能库',
      sort: 9998,
      icon: `${img_host}/navigation/icon35.png`,
      config: createDefaultConfig(),
    },
] as const
}

/**
 * 表单验证规则配置
 */
export const NAVIGATION_FORM_RULES = {
  NAME_REQUIRED: { required: true, message: 'form_input_placeholder' },
  PATH_REQUIRED: { required: true, message: 'form_input_placeholder' },
} as const

/**
 * 自定义类型跳转地址黑名单（首段路径，如 console 表示禁止 /console、/console/xxx）
 */
export const NAVIGATION_CUSTOM_PATH_BLACKLIST = [
  'console',
  'knowledge',
  'library',
  'agentplugin',
  'share',
  'order',
  'mine',
  'profile',
  'webview',
  'guide',
] as const

/**
 * 导航相关常量
 */
export const NAVIGATION_CONSTANTS = {
  /** 最大导航项数量 */
  MAX_ITEMS: 10,
  /** 默认排序值 */
  DEFAULT_SORT: 9999,
} as const
