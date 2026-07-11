import { includeKm } from '@/utils/config'
import { VERSION_MODULE } from '@/constants/enterprise'
import { checkVersion } from '@/utils/version'

export type VisibilityContext = {
  eid: string
  isOpLocalEnv: boolean
  isWorkEnv: boolean
  isIndependent: boolean
  isIndustry: boolean
  isEnterprise: boolean
}

/** 菜单项配置 */
export type MenuItemConfig = {
  /** 路由路径，或子菜单的唯一标识 */
  path: string
  /** 路由名称 */
  name: string
  /** i18n key，同时用于菜单显示文字和路由 meta.title（唯一入口） */
  title?: string
  /** svg-icon 名称 */
  icon?: string
  /** 路由组件（懒加载） */
  component?: () => Promise<any>
  /** 路由 meta（title 之外的附加信息） */
  meta?: Record<string, unknown>
  /** 是否在侧边栏中隐藏（不出现在菜单中，但注册为路由） */
  hidden?: boolean
  /** 动态可见性条件，返回 false 则不在菜单中显示 */
  visible?: (ctx: VisibilityContext) => boolean
  /** 子菜单项 */
  children?: MenuItemConfig[]
}

export const menuTree: MenuItemConfig[] = [
  {
    path: '/index',
    name: 'Index',
    title: 'module.homepage',
    icon: 'home_v3',
  },
  {
    path: '/agent',
    name: 'AppManagement',
    title: 'system_log.log_module',
    icon: 'app',
    children: [
      {
        path: '/agent',
        name: 'Agent',
        title: 'module.agent',
        icon: 'agent_v2',
        visible: (ctx: VisibilityContext) =>
          !['aibtNv'].includes(ctx.eid) && checkVersion(VERSION_MODULE.AGENT),
      },
      ...(includeKm
        ? [
            {
              path: '/knowledge',
              name: 'Knowledge',
              title: 'module.knowledge_space',
              icon: 'knowledge',
              visible: (ctx: VisibilityContext) =>
                !['5bmQZn'].includes(ctx.eid) && checkVersion(VERSION_MODULE.KNOWLEDGE_BASE),
            },
          ]
        : []),
      {
        path: '/skills',
        name: 'Skills',
        title: 'module.skills',
        icon: 'skills',
        visible: () => checkVersion(VERSION_MODULE.WORKBENCH),
      },
      {
        path: '/prompt',
        name: 'Prompt',
        title: 'prompt.title',
        icon: 'prompt_v2',
        visible: (ctx: VisibilityContext) =>
          !['aibtNv'].includes(ctx.eid) && checkVersion(VERSION_MODULE.PROMPT),
      },
      {
        path: '/toolbox',
        name: 'Toolbox',
        title: 'module.ai_toolbox',
        icon: 'toolkit_v2',
        visible: (ctx: VisibilityContext) =>
          !['aibtNv'].includes(ctx.eid) && checkVersion(VERSION_MODULE.AILINK),
      }
    ],
  },
  {
    path: '/user',
    name: 'UserManagement',
    title: 'user',
    icon: 'avatar',
    children: [
      {
        path: '/user/admin',
        name: 'AdminUser',
        title: 'admin_user.title',
        icon: 'person_v2',
      },
      {
        path: '/user/internal',
        name: 'InternalUser',
        title: 'internal_user.title',
        icon: 'peoples-filled',
        visible: (ctx: VisibilityContext) =>
          !ctx.isIndependent && checkVersion(VERSION_MODULE.INTERNAL_USER),
      },
      {
        path: '/user/register',
        name: 'RegisterUser',
        title: 'register_user.title',
        icon: 'register',
        visible: (ctx: VisibilityContext) =>
          (ctx.isIndependent || ctx.isIndustry) && checkVersion(VERSION_MODULE.REGISTERED_USER),
      },
    ],
  },
  {
    path: '/system',
    name: 'SystemConfig',
    title: 'action.setting',
    icon: 'setting',
    children: [
      {
        path: '/config',
        name: 'Config',
        title: 'module.website_info',
        icon: 'setting_v2',
      },
      {
        path: '/platform',
        name: 'Platform',
        title: 'module.platform_center',
        icon: 'platform',
      },
      {
        path: '/SMTP',
        name: 'SMTP',
        title: 'module.SMTP',
        icon: 'sso',
        visible: (ctx: VisibilityContext) => ctx.isOpLocalEnv,
      },
      {
        path: '/system-log',
        name: 'SystemLog',
        title: 'module.system_log',
        icon: 'system_log',
      },
    ],
  },
]

export const hiddenRoutes: MenuItemConfig[] = [
  {
    path: '/agent/create',
    name: 'AgentCreate',
    hidden: true,
  },
  {
    path: '/prompt/create',
    name: 'PromptCreate',
    title: 'prompt.title',
    hidden: true,
  },
  {
    path: '/toolbox/create',
    name: 'ToolboxCreate',
    hidden: true,
  },
  {
    path: '/skills/create',
    name: 'SkillCreate',
    title: 'module.skills',
    hidden: true,
  },
  {
    path: '/user/dialogue-record/:user_id',
    name: 'UserDialogueRecord',
    title: 'dialogue_record',
    hidden: true,
  },
  {
    path: '/info',
    name: 'Info',
    hidden: true,
  },
  {
    path: '/domain',
    name: 'Domain',
    hidden: true,
  },
  {
    path: '/statistics',
    name: 'Statistics',
    hidden: true,
  },
  {
    path: '/template-style',
    name: 'TemplateStyle',
    hidden: true,
  },
  {
    path: '/navigation/web-setting/:navigation_id',
    name: 'NavigationWebSetting',
    title: 'navigation.web_setting',
    hidden: true,
  },
  {
    path: '/operation',
    name: 'OperationManagement',
    title: 'module.operation_management',
    icon: 'operate',
    visible: (ctx: VisibilityContext) => ctx.isIndependent || ctx.isIndustry,
    children: [
      {
        path: '/subscription',
        name: 'Subscription',
        title: 'module.subscription',
      },
      {
        path: '/order',
        name: 'Order',
        title: 'module.operation_order',
      },
    ],
  },
  {
    path: '/payment',
    name: 'Payment',
    title: 'module.payment',
    visible: (ctx: VisibilityContext) =>
      checkVersion(VERSION_MODULE.REGISTERED_USER) && !ctx.isEnterprise,
  },
  ...(includeKm
    ? [
        {
          path: '/assistant',
          name: 'Assistant',
          title: '文档应用',
          hidden: true,
        },
        {
          path: '/assistant/chat',
          name: 'AssistantChat',
          hidden: true,
        },
        {
          path: '/assistant/map',
          name: 'AssistantMap',
          hidden: true,
        },
        {
          path: '/assistant/extract',
          name: 'AssistantExtract',
          title: '知识萃取',
          hidden: true,
        },
        {
          path: '/assistant/podcast',
          name: 'AssistantPodcast',
          title: 'AI播客',
          hidden: true,
        },
        {
          path: '/assistant/app-setting',
          name: 'AssistantAppSetting',
          title: '文档应用设置',
          hidden: true,
        },
        {
          path: '/graph',
          name: 'Graph',
          title: '图谱模板',
          hidden: true,
        },
        {
          path: '/search',
          name: 'Search',
          title: 'module.search',
          visible: (ctx: VisibilityContext) =>
            !['5bmQZn'].includes(ctx.eid) && checkVersion(VERSION_MODULE.KNOWLEDGE_BASE),
        },
      ]
    : []),
]

export function isMenuVisible(item: MenuItemConfig, ctx: VisibilityContext): boolean {
  if (item.hidden) return false
  if (item.visible) return item.visible(ctx)
  return true
}

export function getVisibleChildren(item: MenuItemConfig, ctx: VisibilityContext): MenuItemConfig[] {
  return (item.children || []).filter((child) => isMenuVisible(child, ctx))
}

// ===================== 路由生成工具函数 =====================

/** React Router 路由配置类型 */
export type RouteConfig = {
  path: string
  name?: string
  element?: React.ReactNode
  children?: RouteConfig[]
  meta?: Record<string, unknown>
}

/** 从菜单配置中递归提取路由记录，自动将 title 合并到 meta.title */
export const extractRoutes = (items: MenuItemConfig[]): RouteConfig[] => {
  const routes: RouteConfig[] = []
  for (const item of items) {
    if (item.component) {
      const meta: Record<string, unknown> = { ...item.meta }
      if (item.title) meta.title = item.title
      routes.push({
        path: item.path,
        name: item.name,
        element: undefined, // component 需要在路由配置时用 React.lazy 包装
        meta,
      })
    }
    if (item.children) {
      routes.push(...extractRoutes(item.children))
    }
  }
  return routes
}

/** 生成所有路由记录（菜单路由 + 隐藏路由） */
export const generateRoutes = (): RouteConfig[] => {
  return [...extractRoutes(menuTree), ...extractRoutes(hiddenRoutes)]
}

