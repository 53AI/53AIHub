import { Button, Image } from "antd";
import { useRef } from "react";
import { useAgentCreateAdapter } from "../../adapters";
import type { RelateAgent } from "../../adapters/types";
import { useAgentForm } from "../../hooks";
import {
  RelateAgentsDialog,
  RelateAgentsDialogRef,
} from "./RelateAgentsDialog";
import {
  RelateAgentsSetting,
  RelateAgentsSettingRef,
} from "./RelateAgentsSetting";
import { BACKEND_AGENT_TYPE } from "../../constants";
import { SvgIcon } from "@km/shared-components-react";
import { CollapsibleSection } from "../shared/CollapsibleSection";

export function RelateAgents() {
  const relateAgentsDialogRef = useRef<RelateAgentsDialogRef>(null);
  const relateAgentsSettingRef = useRef<RelateAgentsSettingRef>(null);
  const adapter = useAgentCreateAdapter();
  const t = adapter.t || ((key: string) => key);

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
          label: t('common.input'),
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
      updateRelateAgent(item.agent_id, item);
    } else {
      updateRelateAgents([...relateAgents, item]);
    }
  };

  return (
    <>
      <CollapsibleSection
        title={t("agent.relate_app.title")}
        actions={
          <Button color="default" variant="link" className="px-0" onClick={handleAdd}>
            <SvgIcon name="plus" size={16} />
          </Button>
        }
      >
        {relateAgents.length === 0 && (
          <p className="text-sm text-[#9CA3AF]">{t('agent.relate_tip')}</p>
        )}

        <div className="flex flex-col gap-2">
          {relateAgents.map((item) => (
            <div
              key={item.agent_id}
              className="h-14 flex px-2 items-center gap-2.5 bg-white rounded-xl hover:bg-[#EBEEF3] cursor-pointer group"
            >
              <Image
                src={item.logo}
                classNames={{
                  root: "size-8 rounded",
                }}
                preview={false}
              />
              <div className="flex-1 overflow-hidden">
                <div className="text-sm text-main truncate">{item.name}</div>
                <div className="text-xs text-[#9A9A9A] truncate">
                  {item.description || '--'}
                </div>
              </div>
              <div className="flex gap-2 invisible group-hover:visible">
                <Button
                  color="default"
                  variant="link"
                  className="px-0"
                  onClick={() => handleSetting(item)}
                >
                  <SvgIcon name="setting" />
                </Button>
                <Button
                  color="default"
                  variant="link"
                  className="px-0"
                  onClick={() => handleDelete(Number(item.agent_id))}
                >
                  <SvgIcon name="reduce-one" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <RelateAgentsDialog ref={relateAgentsDialogRef} onSelect={handleSelect} />
      <RelateAgentsSetting ref={relateAgentsSettingRef} onSave={handleSave} />
    </>
  );
}

export default RelateAgents;
