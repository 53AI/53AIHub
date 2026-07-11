import type { PluginConfig } from '@km/shared-business'

export const config: PluginConfig = {
  type: 'agent',
  title: 'Agent Chat',
  features: {
    showRagStats: true,
    showFileUpload: true,
    showConversationList: true,
  },
}
