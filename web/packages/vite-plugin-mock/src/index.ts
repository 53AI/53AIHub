import type { Plugin } from 'vite'
import { handleRequest, registerRoutes, type MockRoute } from './router.js'
import { commonRoutes } from './mock-data/_common.js'
import { userRoutes } from './mock-data/user.js'
import { agentRoutes } from './mock-data/agent.js'
import { libraryRoutes } from './mock-data/library.js'
import { conversationRoutes } from './mock-data/conversation.js'
import { channelRoutes } from './mock-data/channel.js'
import { fileRoutes } from './mock-data/file.js'
import { chunkRoutes } from './mock-data/chunk.js'
import { spaceRoutes } from './mock-data/space.js'
import { departmentRoutes } from './mock-data/department.js'
import { promptRoutes } from './mock-data/prompt.js'
import { notificationRoutes } from './mock-data/notification.js'
import { permissionRoutes } from './mock-data/permission.js'
import { navigationRoutes } from './mock-data/navigation.js'
import { groupRoutes } from './mock-data/group.js'
import { settingsRoutes } from './mock-data/setting.js'
import { providerRoutes } from './mock-data/provider.js'
import { feedbackRoutes } from './mock-data/feedback.js'
import { enterpriseConfigRoutes } from './mock-data/enterprise-config.js'
import { aiLinkRoutes } from './mock-data/ai-link.js'
import { chatRoutes } from './mock-data/chat.js'
import {
  uploadRoutes,
  fileBodyRoutes,
  platformSettingsRoutes,
  embeddingRoutes,
  chunkSettingRoutes,
  shareRoutes,
  shortcutRoutes,
  favoriteRoutes,
  approvalRoutes,
  subscriptionRoutes,
  ragRoutes,
  apiKeyRoutes,
  systemRoutes,
  messageRoutes,
  orderRoutes,
  searchRoutes,
  entityRoutes,
} from './mock-data/extra.js'

export interface MockPluginOptions {
  /** Enable/disable the plugin (default: true when loaded) */
  enabled?: boolean
  /** Additional custom routes */
  routes?: MockRoute[]
  /** API prefix to intercept (default: ['/api', '/v1']) */
  prefixes?: string[]
  /** Log matched requests */
  verbose?: boolean
}

let registered = false

export function vitePluginMock(options: MockPluginOptions = {}): Plugin {
  const {
    enabled = true,
    routes: customRoutes = [],
    prefixes = ['/api', '/v1'],
    verbose = true,
  } = options

  return {
    name: 'vite-plugin-mock',
    configureServer(server) {
      if (!enabled) return

      if (!registered) {
        const allRoutes: MockRoute[] = [
          ...commonRoutes,
          ...userRoutes,
          ...agentRoutes,
          ...libraryRoutes,
          ...conversationRoutes,
          ...channelRoutes,
          ...fileRoutes,
          ...chunkRoutes,
          ...spaceRoutes,
          ...departmentRoutes,
          ...promptRoutes,
          ...notificationRoutes,
          ...permissionRoutes,
          ...navigationRoutes,
          ...groupRoutes,
          ...settingsRoutes,
          ...providerRoutes,
          ...feedbackRoutes,
          ...enterpriseConfigRoutes,
          ...aiLinkRoutes,
          ...chatRoutes,
          ...uploadRoutes,
          ...fileBodyRoutes,
          ...platformSettingsRoutes,
          ...embeddingRoutes,
          ...chunkSettingRoutes,
          ...shareRoutes,
          ...shortcutRoutes,
          ...favoriteRoutes,
          ...approvalRoutes,
          ...subscriptionRoutes,
          ...ragRoutes,
          ...apiKeyRoutes,
          ...systemRoutes,
          ...messageRoutes,
          ...orderRoutes,
          ...searchRoutes,
          ...entityRoutes,
          ...customRoutes,
        ]
        registerRoutes(allRoutes)
        registered = true
      }

      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '/'
        const pathname = url.split('?')[0]

        const shouldIntercept = prefixes.some(
          (prefix) => pathname === prefix || pathname.startsWith(prefix + '/')
        )

        if (!shouldIntercept) {
          return next()
        }

        const handled = await handleRequest(req, res)
        if (handled) {
          if (verbose) {
            console.log(`  [mock] ${req.method} ${pathname}`)
          }
          return
        }

        next()
      })
    },
  }
}

export default vitePluginMock

export type { MockRoute } from './router.js'
