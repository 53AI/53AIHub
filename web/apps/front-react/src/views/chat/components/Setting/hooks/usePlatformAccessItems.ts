import { useState, useEffect } from 'react';
import type { IAgentInfo } from '@km/shared-business/chat';
import { t } from '@/locales';
import { AGENT_TYPES } from '@km/shared-business/agent-create/constants';
import { getAgentByAgentType, type AgentType } from '@/constants/platform/config';
import { frontAgentAdapter } from '@/adapters/agent-create-adapter';

/**
 * 根据 agent_type 获取平台名称（复用已有的国际化配置）
 */
function getPlatformName(agentType: string): string {
  return getAgentByAgentType(agentType as AgentType)?.label || agentType;
}

/**
 * 获取 provider 名称
 */
async function fetchProviderName(agentType: string, providerId: number): Promise<string> {
  if (!providerId) return '--';
  try {
    const result = await frontAgentAdapter.getPlatformConfig?.({
      platform: agentType,
      type: 'providers',
    });
    const provider = result?.providers?.find((p: any) => p.provider_id === providerId);
    return provider?.name || '--';
  } catch {
    return '--';
  }
}

/**
 * 同步平台配置：只读展示 base_url、agent_type 等
 */
function getSyncPlatformItems(
  agentType: string,
  channelConfig: Record<string, any>,
): { label: string; value?: string }[] | null {
  const baseUrl = channelConfig.base_url || '--';

  switch (agentType) {
    case AGENT_TYPES.DIFY_AGENT:
    case AGENT_TYPES.DIFY_WORKFLOW:
      return [{ label: t('api_host'), value: baseUrl }];
    case AGENT_TYPES.FASTGPT_AGENT:
    case AGENT_TYPES.FASTGPT_WORKFLOW:
      return [{ label: t('ap_host_fastgpt'), value: baseUrl }];
    case AGENT_TYPES.VOLCENGINE:
      return [
        { label: t('module.platform_model_base_url'), value: baseUrl },
        { label: t('term.agent_type'), value: t('term.agent_type_chat') },
      ];
    case AGENT_TYPES.MAXKB_AGENT:
      return [
        { label: t('module.platform_model_base_url_maxkb'), value: baseUrl },
        { label: t('term.agent_type'), value: t('term.agent_type_chat') },
      ];
    case AGENT_TYPES.N8N_WORKFLOW:
      return [{ label: t('module.platform_model_webhook_url'), value: baseUrl }];
    case AGENT_TYPES.BAILIAN:
    case AGENT_TYPES.YUANQI:
      return [{ label: t('term.agent_type'), value: t('term.agent_type_chat') }];
    default:
      return null;
  }
}

/**
 * 异步获取平台接入展示项的 hook
 */
export function usePlatformAccessItems(agent: IAgentInfo): { items: { label: string; value?: string }[]; loading: boolean } {
  const [items, setItems] = useState<{ label: string; value?: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const customConfig = agent.custom_config_obj || {};
    const agentType = customConfig.agent_type || '';
    const channelConfig = customConfig.channel_config || {};
    const providerId = customConfig.provider_id;
    const platformName = getPlatformName(agentType);

    // 第一项固定为平台名称
    const firstItem = { label: t('agent.platform'), value: platformName };

    // Prompt - 展示模型（无需异步）
    if (agentType === AGENT_TYPES.PROMPT) {
      setItems([firstItem, { label: t('term.access_model'), value: agent.model || '--' }]);
      setLoading(false);
      return;
    }

    // 同步平台：直接从配置读取
    const syncItems = getSyncPlatformItems(agentType, channelConfig);
    if (syncItems) {
      setItems([firstItem, ...syncItems]);
      setLoading(false);
      return;
    }

    // 异步平台：需要调用 API 获取 provider_name / bot_name
    const fetchDisplayInfo = async () => {
      const providerName = await fetchProviderName(agentType, providerId);
      let extraItems: { label: string; value?: string }[] = [];

      try {
        switch (agentType) {
          case AGENT_TYPES.COZE_AGENT_CN: {
            const workspaceId = customConfig.coze_workspace_id;
            const botId = customConfig.coze_bot_id;
            let workspaceName = '--';
            let botName = '--';

            if (workspaceId && providerId) {
              const wsResult = await frontAgentAdapter.getPlatformConfig?.({
                platform: agentType,
                provider_id: providerId,
              });
              const workspace = wsResult?.find?.((w: any) => w.id === workspaceId);
              workspaceName = workspace?.name || '--';
            }

            if (botId && workspaceId) {
              const botResult = await frontAgentAdapter.getPlatformConfig?.({
                platform: agentType,
                type: 'bots',
                workspace_id: workspaceId,
                provider_id: providerId,
              });
              const bot = botResult?.bots?.find((b: any) => b.bot_id === botId);
              botName = bot?.bot_name || '--';
            }

            extraItems = [
              { label: t('agent_app.coze_agent_cn'), value: providerName },
              { label: t('agent.coze.workspace'), value: workspaceName },
              { label: t('agent.name'), value: botName },
            ];
            break;
          }

          case AGENT_TYPES.COZE_WORKFLOW_CN:
            extraItems = [
              { label: t('agent_app.coze_agent_cn'), value: providerName },
              { label: t('agent.coze.workflow_link'), value: customConfig.coze_bot_url || '--' },
            ];
            break;

          case AGENT_TYPES.COZE_AGENT_OSV:
          case AGENT_TYPES.COZE_WORKFLOW_OSV: {
            const linkLabel = agentType === AGENT_TYPES.COZE_WORKFLOW_OSV
              ? t('agent.coze.workflow_link')
              : t('agent.coze.agent_link');
            extraItems = [
              { label: t('module.website_info_name'), value: providerName },
              { label: linkLabel, value: channelConfig.base_url || '--' },
            ];
            break;
          }

          case AGENT_TYPES.APP_BUILDER: {
            const botId = customConfig.app_builder_bot_id;
            let botName = '--';
            if (botId && providerId) {
              const botResult = await frontAgentAdapter.getPlatformConfig?.({
                platform: agentType,
                provider_id: providerId,
              });
              const bot = botResult?.find?.((b: any) => b.id === botId);
              botName = bot?.name || '--';
            }
            extraItems = [
              { label: t('agent_app.app_builder'), value: providerName },
              { label: t('term.select_agent'), value: botName },
            ];
            break;
          }

          case AGENT_TYPES['53AI_AGENT']:
          case AGENT_TYPES['53AI_WORKFLOW']: {
            const agentId = customConfig.chat53ai_agent_id;
            let botName = '--';
            if (agentId && providerId) {
              const botResult = await frontAgentAdapter.getPlatformConfig?.({
                platform: agentType,
                provider_id: providerId,
              });
              const bots = botResult?.bots || botResult?.workflows || [];
              const bot = bots.find((b: any) => b.bot_id === agentId);
              botName = bot?.name || '--';
            }
            extraItems = [
              { label: t('agent_app.53ai_agent'), value: providerName },
              { label: t('term.select_agent'), value: botName },
            ];
            break;
          }

          case AGENT_TYPES.TENCENT: {
            const botId = customConfig.tencent_bot_id;
            let botName = '--';
            if (botId && providerId) {
              const botResult = await frontAgentAdapter.getPlatformConfig?.({
                platform: agentType,
                provider_id: providerId,
              });
              const bot = botResult?.bots?.find((b: any) => b.AppBizId === botId);
              botName = bot?.Name || '--';
            }
            extraItems = [
              { label: t('agent_app.tencent'), value: providerName },
              { label: t('term.select_agent'), value: botName },
            ];
            break;
          }

          default:
            break;
        }
      } catch {
        // 保持 extraItems 为空
      }

      setItems([firstItem, ...extraItems]);
      setLoading(false);
    };

    fetchDisplayInfo();
  }, [agent]);

  return { items, loading };
}

export default usePlatformAccessItems;
