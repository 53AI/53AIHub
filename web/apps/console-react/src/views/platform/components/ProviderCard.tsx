import { Button, Divider, Spin } from "antd";
import { t } from "@/locales";
import { VERSION_MODULE } from "@/constants/enterprise";
import { useVersion } from "@/hooks";
import { getPublicPath } from "@/utils/config";

interface ProviderOption {
  id: number;
  icon: string;
  label: string;
  auth: boolean;
  connected: boolean;
  authed_time: string;
  agentTotal: number;
  channelLoading: boolean;
  provider_id?: number;
}

interface ProviderCardProps {
  provider: ProviderOption;
  allTotal: number;
  onAuthorize: (data: ProviderOption) => void;
  onAdd: (data: ProviderOption) => void;
  onDelete: (data: ProviderOption) => void;
}

export function ProviderCard({
  provider,
  allTotal,
  onAuthorize,
  onAdd,
  onDelete,
}: ProviderCardProps) {
  const { guard: guardAgentVersion } = useVersion({
    module: VERSION_MODULE.AGENT,
    count: allTotal,
    content: t("version.agent_limit"),
  });

  const handleAuthorize = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAuthorize(provider);
  };

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (guardAgentVersion()) {
      onAdd(provider);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(provider);
  };

  return (
    <li className=" h-[178px] flex flex-col border rounded box-border overflow-hidden">
      <div className="flex items-center gap-4 p-5 box-border">
        <img
          className="flex-none w-10 h-10 overflow-hidden"
          src={getPublicPath(`/images/platform/${provider.icon}.png`)}
          alt=""
        />
        <div className="text-dark font-semibold line-clamp-2">
          {provider.label}
        </div>
      </div>
      <div className="text-xs text-secondary px-5 box-border">
        {t("connecting_agent_total", { total: provider.agentTotal })}
      </div>
      <div className="flex-1 w-full flex items-center justify-center">
        <Spin spinning={provider.channelLoading}></Spin>
      </div>
      <div className="w-full h-11 flex border-t box-border">
        {!provider.auth ? (
          <>
            <Button
              className="flex-1 h-[46px] text-brand !border-none !outline-none rounded-none"
              type="link"
              size="default"
              onClick={handleAuthorize}
            >
              {t("action_manage")}
            </Button>
            <Divider type="vertical" className="!h-full !mx-1" />
            <Button
              className="flex-1 h-[46px] !border-none !outline-none rounded-none"
              type="link"
              size="default"
              onClick={handleAdd}
            >
              {t("action_add")}
            </Button>
          </>
        ) : provider.connected ? (
          <>
            <Button
              className="flex-1 h-[46px] !border-none !outline-none rounded-none"
              type="link"
              size="default"
              onClick={handleAuthorize}
            >
              {t("action_edit")}
            </Button>
            <Divider type="vertical" className="!h-full !mx-1" />
            <Button
              className="flex-1 h-[46px] text-hint !border-none !outline-none rounded-none"
              type="link"
              size="default"
              onClick={handleDelete}
            >
              {t("action_delete")}
            </Button>
          </>
        ) : (
          <Button
            className="flex-1 h-[46px] bg-[#F3F6FE] text-brand !border-none !outline-none rounded-none"
            type="default"
            size="default"
            onClick={handleAuthorize}
          >
            {t("action_manage")}
          </Button>
        )}
      </div>
    </li>
  );
}

export default ProviderCard;
