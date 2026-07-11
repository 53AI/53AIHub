import { Button, Image } from "antd";
import { useRef } from "react";
import { t } from "@/locales";
import { useAgentForm } from "../../hooks";
import {
    RelateAgentsDialog,
    RelateAgentsDialogRef,
} from "./RelateAgentsDialog";
import {
    RelateAgentsSetting,
    RelateAgentsSettingRef,
} from "./RelateAgentsSetting";
import { BACKEND_AGENT_TYPE } from "@/constants/platform/config";
import { SvgIcon } from "@km/shared-components-react";

interface RelateAgent {
  agent_id: number;
  id: string;
  name: string;
  logo: string;
  description?: string;
  input_fields: {
    id: string;
    type: string;
    label: string;
    variable: string;
    required?: boolean;
  }[];
  field_mapping: Record<string, string>;
  execution_rule: "auto" | "manual";
  is_workflow?: boolean;
}

export function RelateAgents() {
  const relateAgentsDialogRef = useRef<RelateAgentsDialogRef>(null);
  const relateAgentsSettingRef = useRef<RelateAgentsSettingRef>(null);

  // 使用 hook 获取状态和方法
  const { formData, updateRelateAgents, updateRelateAgent } = useAgentForm();
  const relateAgents = formData.settings.relate_agents || [];

  const handleAdd = () => {
    relateAgentsDialogRef.current?.open(relateAgents);
  };

  const handleSetting = (item: RelateAgent) => {
    relateAgentsSettingRef.current?.open(item);
  };

  const handleDelete = (agent_id: number) => {
    updateRelateAgents(
      relateAgents.filter((item) => item.agent_id !== agent_id),
    );
  };

  const handleSelect = (item: any) => {
    let input_fields = item.settings?.input_fields || [];
    const is_workflow = BACKEND_AGENT_TYPE.WORKFLOW === item.backend_agent_type;
    if (!is_workflow) {
      input_fields = [
        {
          id: "input",
          type: "text",
          label: "输入",
          variable: "input",
        },
      ];
    }
    const data: RelateAgent = {
      agent_id: item.agent_id,
      name: item.name,
      logo: item.logo,
      description: item.description,
      input_fields,
      execution_rule: "auto",
      is_workflow,
      field_mapping: input_fields.reduce(
        (acc: Record<string, string>, field: any) => {
          acc[field.id] = "";
          return acc;
        },
        {},
      ),
    };
    handleSetting(data);
  };

  const handleSave = (item: RelateAgent) => {
    const index = relateAgents.findIndex(
      (data) => data.agent_id === item.agent_id,
    );
    if (index !== -1) {
      updateRelateAgent(item);
    } else {
      updateRelateAgents([...relateAgents, item]);
    }
  };

  return (
    <>
      <div className="flex items-center mb-3">
        <div className="flex-1 text-sm text-secondary">
          {t("agent.relate_app.title")}
        </div>
        <Button type="link" className="px-0" onClick={handleAdd}>
          <SvgIcon name="plus" className="size-3" />
          {t("action_add")}
        </Button>
      </div>

      {relateAgents.length === 0 && (
        <p className="text-sm text-disabled">{t("agent.relate_app.desc")}</p>
      )}

      <div className="flex flex-col">
        {relateAgents.map((item) => (
          <div
            key={item.agent_id}
            className="flex py-4 items-center gap-2 border-b"
          >
            <Image
              src={item.logo}
              classNames={{
                root: "size-10 rounded",
              }}
              preview={false}
            />
            <div className="flex-1 overflow-hidden">
              <div className="text-sm text-primary truncate">{item.name}</div>
              <div className="text-xs text-disabled mt-1 truncate">
                {item.description}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="link"
                className="px-0"
                onClick={() => handleSetting(item)}
              >
                <SvgIcon name="setting" />
              </Button>
              <Button
                type="link"
                className="px-0"
                onClick={() => handleDelete(item.agent_id)}
              >
                <SvgIcon name="del" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <RelateAgentsDialog ref={relateAgentsDialogRef} onSelect={handleSelect} />
      <RelateAgentsSetting ref={relateAgentsSettingRef} onSave={handleSave} />
    </>
  );
}

export default RelateAgents;
