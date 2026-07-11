import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { message, Modal } from "antd";
import { t } from "@/locales";
import { agentApi } from "@/api/modules/agent";
import { providerApi } from "@/api/modules/provider";
import {
    getProvidersByAuth,
    type ProviderConfig,
} from "@/constants/platform/config";
import { PROVIDER_VALUE } from "@/constants/platform/provider";
import { isInternalNetwork } from "@km/shared-utils";
import { ProviderCard } from "./components/ProviderCard";
import {
    AuthListDrawer,
    type AuthListDrawerRef,
} from "./components/AuthListDrawer";
import {
    AgentListDrawer,
    type AgentListDrawerRef,
} from "./components/AgentListDrawer";

interface ProviderOption extends ProviderConfig {
  agentTotal: number;
  channelLoading: boolean;
  provider_id?: number;
}

interface ProviderGroup {
  label: string;
  children: ProviderOption[];
}

const createProviderOption = (item: ProviderConfig): ProviderOption => ({
  ...item,
  agentTotal: 0,
  channelLoading: !item.auth,
});

export function PlatformAgent() {
  const authListDrawerRef = useRef<AuthListDrawerRef>(null);
  const agentListDrawerRef = useRef<AgentListDrawerRef>(null);

  const [authProviders, setAuthProviders] = useState<ProviderOption[]>(() =>
    getProvidersByAuth(true).map(createProviderOption),
  );
  const [agentProviders, setAgentProviders] = useState<ProviderOption[]>(() =>
    getProvidersByAuth(false).map(createProviderOption),
  );
  const [providerTotal, setProviderTotal] = useState(0);

  const providerGroupList = useMemo<ProviderGroup[]>(() => {
    const list = [...authProviders, ...agentProviders];
    return list.reduce((acc: ProviderGroup[], item) => {
      let group = acc.find((row) => row.label === item.category);
      if (!group) {
        group = { label: item.category, children: [] };
        acc.push(group);
      }
      group.children.push(item);
      return acc;
    }, []);
  }, [authProviders, agentProviders]);

  const loadProviderList = useCallback(async () => {
    const list = await providerApi.list();
    setAuthProviders((prev) =>
      prev.map((item) => {
        const providerData = list.filter(
          (row: any) => item.id === row.provider_type,
        );
        return {
          ...item,
          agentTotal: providerData.length,
        };
      }),
    );
  }, []);

  const loadAllTotal = useCallback(async () => {
    const { count = 0 } = await agentApi.list({
      params: { group_id: "-1", keyword: "", offset: 0, limit: 1 },
    });
    setProviderTotal(count as number);
  }, []);

  const loadAgentListCount = useCallback(async () => {
    loadAllTotal();
    const promises = agentProviders.map(async (provider) => {
      const { count = 0 } = await agentApi.list({
        params: { channel_types: provider.id.toString(), limit: 1 },
      });
      provider.agentTotal = count as number;
      provider.channelLoading = false;
    });
    await Promise.all(promises);
    setAgentProviders([...agentProviders]);
  }, [agentProviders, loadAllTotal]);

  const handleProviderAuthorize = useCallback((data: ProviderOption) => {
    if (
      [PROVIDER_VALUE.COZE_CN, PROVIDER_VALUE.COZE_OSV].includes(data.id) &&
      isInternalNetwork()
    ) {
      Modal.warning({
        title: t("local_config_limited_tip"),
        content: t("local_config_limited_desc", { url: window.location.href }),
        okText: t("know_it"),
      });
      return;
    }
    if (data.auth) {
      authListDrawerRef.current?.open({ data });
    } else {
      agentListDrawerRef.current?.open({ data, type: data.id });
    }
  }, []);

  const handleAgentAdd = useCallback((data: ProviderOption) => {
    agentListDrawerRef.current?.create({ data, type: data.id });
  }, []);

  const handleProviderDelete = useCallback(
    async (data: ProviderOption) => {
      if (!data.provider_id) return;

      Modal.confirm({
        title: t("action_delete"),
        content: t("module.platform_delete_confirm"),
        okText: t("action_confirm"),
        cancelText: t("action_cancel"),
        onOk: async () => {
          await providerApi.delete({
            data: { provider_id: data.provider_id! },
          });
          message.success(t("action_delete_success"));
          setTimeout(() => {
            setAuthProviders(
              getProvidersByAuth(true).map(createProviderOption),
            );
            loadProviderList();
          }, 1000);
        },
      });
    },
    [loadProviderList],
  );

  const onAgentListChange = useCallback(
    ({ data, count }: { data: ProviderOption; count: number }) => {
      const provider = agentProviders.find((item) => item.id === data.id);
      if (provider) {
        provider.agentTotal = count;
        setAgentProviders([...agentProviders]);
      }
      loadAgentListCount();
    },
    [agentProviders, loadAgentListCount],
  );

  const refresh = useCallback(() => {
    loadProviderList();
    loadAgentListCount();
  }, [loadProviderList, loadAgentListCount]);

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="h-full flex flex-col bg-white py-6 px-2">
      {providerGroupList.map((group) => (
        <div key={group.label}>
          <h2 className="font-semibold text-base text-primary mb-6">
            {t(group.label)}
          </h2>
          <ul className="grid grid-cols-4 gap-4 mb-8 md:grid-cols-3 sm:grid-cols-2">
            {group.children.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                allTotal={providerTotal}
                onAuthorize={handleProviderAuthorize}
                onAdd={handleAgentAdd}
                onDelete={handleProviderDelete}
              />
            ))}
          </ul>
        </div>
      ))}

      <AuthListDrawer ref={authListDrawerRef} onChange={loadProviderList} />
      <AgentListDrawer ref={agentListDrawerRef} onChange={onAgentListChange} />
    </div>
  );
}

export default PlatformAgent;
