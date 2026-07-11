/**
 * KnowledgeSenderExtras — agent_usage === 1 (KM_AI_SEARCH) 时,渲染在 Sender 左下方的扩展区。
 * 内容:模型选择器 + 知识源选择器(对齐 knowledge/chat.tsx line 1422-1461)
 */
import type { MenuProps } from "antd";
import { Dropdown } from "@km/shared-components-react";
import { DownOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { ModelView } from "@/components/Model/view";
import { KnowledgeSourceSelector, type KnowledgeSourceState } from "@/components/KnowledgeSource";
import { useUserStore } from "@/stores/modules/user";
import { useNavigationStore } from "@/stores/modules/navigation";
import { t } from "@/locales";

export interface KnowledgeSenderExtrasProps {
  modelMenuItems: Array<{ key: string; label: React.ReactNode }>;
  agentModels: Array<{ id: number; name: string; value: string; icon: string }>;
  model: string;
  onChangeModel: (value: string) => void;
  knowledgeSource: KnowledgeSourceState;
  onChangeKnowledgeSource: (state: KnowledgeSourceState) => void;
  library: { name: string; value: string[]; isSpace: boolean };
  /** 是否内部用户(决定 KnowledgeSourceSelector 是否可点) */
  isInternal?: boolean;
  /**
   * 真实 agentInfo(用于 KnowledgeSourceSelector 决定「知识图谱」/「联网搜索」菜单项是否显示)
   * 不传时降级为空对象,对应入口不显示图谱/联网
   */
  agentInfo?: {
    agent_id: string | number;
    name: string;
    logo?: string;
    settings?: {
      web_search_setting?: { enable: boolean };
      graph_search_setting?: { enable: boolean; default_enable: boolean };
    };
  };
}

export function KnowledgeSenderExtras(props: KnowledgeSenderExtrasProps) {
  const {
    modelMenuItems,
    agentModels,
    model,
    onChangeModel,
    knowledgeSource,
    onChangeKnowledgeSource,
    library,
    isInternal,
    agentInfo,
  } = props;

  const userStore = useUserStore();
  const navigationStore = useNavigationStore();

  // 如果上层没有传 menuItems,就自己组装
  const items: MenuProps["items"] = modelMenuItems.length
    ? modelMenuItems
    : agentModels.map((item) => ({
        key: item.value,
        label: (
          <div
            className={`w-full h-9 flex items-center gap-2 ${item.value === model ? "text-[#2563EB]" : "text-[#1D1E1F]"}`}
          >
            <SvgIcon name={item.icon} />
            <span className="text-sm whitespace-nowrap">{item.name}</span>
            <ModelView showIcon={false} channelId={(item as any).channel_id} model={(item as any).model} />
            {item.value === model && <SvgIcon name="check" />}
          </div>
        ),
      }));

  const currentModel = agentModels.find((m) => m.value === model);

  return (
    <div className="flex items-center gap-2">
      {/* 模型选择 */}
      <Dropdown
        menu={{
          items,
          onClick: ({ key }) => onChangeModel(key),
        }}
        trigger={["click"]}
        placement="bottom"
      >
        <div className="h-8 px-4 flex items-center gap-1 rounded-full border border-[#E3EEFF] bg-[#F3F8FF] cursor-pointer text-[#2563EB]">
          {currentModel ? (
            <>
              <SvgIcon name={currentModel.icon} />
              <span className="text-sm whitespace-nowrap">{currentModel.name}</span>
            </>
          ) : (
            <span className="text-sm whitespace-nowrap">{t("chat.select_model")}</span>
          )}
          <div className="size-4 flex items-center justify-center">
            <DownOutlined style={{ fontSize: "14px" }} />
          </div>
        </div>
      </Dropdown>

      {/* 知识源选择器 */}
      {userStore.is_login && navigationStore.hasKnowledge && (
        <KnowledgeSourceSelector
          value={knowledgeSource}
          onChange={onChangeKnowledgeSource}
          library={library}
          disabled={isInternal === false}
          allowSelectLibrary={true}
          allowSelectSpace={true}
          agentInfo={
            agentInfo
              ? {
                  agent_id: String(agentInfo.agent_id ?? ""),
                  name: agentInfo.name ?? "",
                  logo: agentInfo.logo ?? "",
                  settings: agentInfo.settings
                    ? {
                        web_search_setting: agentInfo.settings.web_search_setting,
                        graph_search_setting: agentInfo.settings.graph_search_setting,
                      }
                    : undefined,
                }
              : { agent_id: "", name: "", logo: "" }
          }
        />
      )}
    </div>
  );
}

export default KnowledgeSenderExtras;
