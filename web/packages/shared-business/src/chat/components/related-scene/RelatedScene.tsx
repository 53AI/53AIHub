import { memo } from "react";
import { SvgIcon } from "@km/shared-components-react";
import { useTranslation } from "../../i18n";

interface OutputField {
  id: string;
  label: string;
  value: string;
  variable: string;
}

interface RelatedSceneItem {
  scene: string;
  agent_id: string;
  name: string;
  description: string;
  logo: string;
  execution_rule?: string;
  is_workflow?: boolean;
  field_mapping: Record<string, string>;
}

export interface RelatedSceneProps {
  /** 是否为工作流模式 */
  isWorkflow?: boolean;
  /** 当前输出内容 */
  output: OutputField[] | string;
  /** 相关智能体配置列表 - 从 agent.settings_obj.relate_agents 获取 */
  relateAgents?: RelatedSceneItem[];
  /** 当前智能体 ID - 用于判断是否跳转到同一智能体 */
  currentAgentId?: string | number;
  /** 选择下一个智能体回调 */
  onNextAgent?: (item: RelatedSceneItem, parameters: Record<string, string>) => void;
  /** 重新初始化当前智能体回调 - 当跳转到同一智能体时触发 */
  onInitAgent?: () => void;
}

const DEFAULT_IMG = "/images/default_agent.png";

function handleImageError(e: React.SyntheticEvent<HTMLImageElement>) {
  const target = e.target as HTMLImageElement;
  if (target.src.endsWith(DEFAULT_IMG)) return;
  target.src = DEFAULT_IMG;
}

function RelatedSceneInner({
  isWorkflow = false,
  output,
  relateAgents,
  currentAgentId,
  onNextAgent,
  onInitAgent,
}: RelatedSceneProps) {
  const { t } = useTranslation();

  const getParameter = (): OutputField[] => {
    if (isWorkflow) return output as OutputField[];
    return [
      {
        id: "output",
        label: "",
        value: output as string,
        variable: "text",
      },
    ];
  };

  const handleNextAgent = (item: RelatedSceneItem) => {
    const parameters = getParameter();
    const mappedParams = Object.keys(item.field_mapping || {}).reduce((acc, key) => {
      acc[key] = item.field_mapping[key].replace(/\{\#(.*?)\#\}/g, (_match, p1) => {
        return parameters.find((param) => param.variable === p1)?.value || "";
      });
      return acc;
    }, {} as Record<string, string>);

    onNextAgent?.(item, mappedParams);

    // 当跳转到同一个智能体时，触发重新初始化
    if (String(item.agent_id) === String(currentAgentId)) {
      setTimeout(() => {
        onInitAgent?.();
      }, 0);
    }
  };

  if (!relateAgents || relateAgents.length === 0) return null;

  return (
    <div className="w-full mt-4">
      {isWorkflow ? (
        <div className="flex items-center justify-center">
          <div className="h-px flex-1 bg-[#E5E6EB]" />
          <span className="px-4 text-sm text-[#999]">{t("related_scene.next_step") || "下一步操作"}</span>
          <div className="h-px flex-1 bg-[#E5E6EB]" />
        </div>
      ) : (
        <div className="flex items-center mb-3">
          <SvgIcon name="related" stroke className="text-[#6B6C70]" />
          <p className="pl-2 text-sm text-[#6B6C70]">{t("related_scene.title") || "相关场景"}</p>
        </div>
      )}
      <div className={`grid gap-4 mt-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 ${isWorkflow ? "p-4" : ""}`}>
        {relateAgents.map((item) => (
          <div
            key={item.agent_id}
            className="flex items-center gap-2 p-4 border border-[#e8e8e8] rounded-md cursor-pointer transition-all hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)]"
            onClick={() => handleNextAgent(item)}
          >
            <img
              className="w-10 h-10 rounded-md flex-shrink-0"
              src={item.logo || DEFAULT_IMG}
              alt={item.name}
              onError={handleImageError}
            />
            <div className="flex-1 min-w-0">
              <h6 className="text-sm m-0 overflow-hidden text-ellipsis whitespace-nowrap">{item.name}</h6>
              <p className="text-xs text-[#999] m-0 overflow-hidden text-ellipsis whitespace-nowrap">{item.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const RelatedScene = memo(RelatedSceneInner);
RelatedScene.displayName = "RelatedScene";

export default RelatedScene;
