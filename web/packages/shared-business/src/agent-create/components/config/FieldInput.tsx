import { Button, message, Table, Tooltip } from "antd";
import { PlusOutlined, SyncOutlined } from "@ant-design/icons";
import { useCallback, useRef } from "react";
import { useAgentCreateAdapter } from "../../adapters";
import { inputTypeList, outputTypeList } from "../../constants";
import { FieldInputSetting, FieldInputSettingRef } from "./FieldInputSetting";
import { SvgIcon } from "@km/shared-components-react";
import { CollapsibleSection } from "../shared/CollapsibleSection";
import type { FieldItem } from "../../adapters/types";

interface FieldInputProps {
  list: FieldItem[];
  onChange: (list: FieldItem[]) => void;
  title?: string;
  allowUpdate?: boolean;
  allowAdd?: boolean;
  updateRequest?: () => Promise<FieldItem[]>;
  type: "input" | "output";
  agentType?: string;
  className?: string
}

export function FieldInput({
  list,
  onChange,
  title = "",
  allowUpdate = false,
  allowAdd = false,
  updateRequest = () => Promise.resolve([]),
  type = "input",
  agentType = "",
  className = ""
}: FieldInputProps) {
  const fieldSaveRef = useRef<FieldInputSettingRef>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adapter = useAgentCreateAdapter();
  const t = adapter.t || ((key: string) => key);

  const getLabel = (fieldType: string) => {
    const item = [...inputTypeList, ...outputTypeList].find(
      (item) => item.type === fieldType,
    );
    if (item) {
      // 翻译标签（item.label 是翻译 key）
      return t(item.label);
    }
    return fieldType;
  };

  const handleFieldAdd = () => {
    fieldSaveRef.current?.open({});
  };

  const handleFieldUpdate = useCallback(async () => {
    if (debounceRef.current) {
      return;
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
    }, 500);
    const newList: FieldItem[] = await updateRequest();
    const oldList = list.filter((item) => !item.is_system);
    onChange([...oldList, ...newList]);
    message.success(t('action.sync_success'));
  }, [list, onChange, updateRequest, t]);

  const handleFieldEdit = (row: FieldItem) => {
    fieldSaveRef.current?.open(row);
  };

  const handleFieldDelete = (_row: FieldItem, index: number) => {
    const newList = list.filter((_, i) => i !== index);
    onChange(newList);
  };

  const handleFieldSave = (value: FieldItem) => {
    const newList = [...list];
    const index = newList.findIndex((item) => item.id === value.id);
    if (index !== -1) {
      newList[index] = value;
    } else {
      newList.push(value);
    }
    onChange(newList);
  };

  const columns = [
    {
      title: t("agent.variable_name"),
      dataIndex: "variable",
      key: "variable",
      ellipsis: true,
    },
    {
      title: t("agent.variable_type"),
      dataIndex: "type",
      key: "type",
      render: (text: string) => getLabel(text),
    },
    {
      title: t("agent.variable_label"),
      dataIndex: "label",
      key: "label",
      ellipsis: true,
    },
    {
      title: t("action.operation"),
      key: "operation",
      width: 70,
      render: (_: any, record: FieldItem, index: number) => (
        <div className="flex items-center gap-2 cursor-pointer">
          <SvgIcon
            name="edit"
            size={16}
            onClick={() => handleFieldEdit(record)}
          />
          {allowAdd && (
            <SvgIcon
              name="del"
              size={16}
              onClick={() => handleFieldDelete(record, index)}
            />
          )}
        </div>
      ),
    },
  ];

  const actions = (
    <>
      {allowAdd && (
        <Button color="default" variant="link" className="px-0" onClick={handleFieldAdd}>
          <PlusOutlined />
        </Button>
      )}
      {allowUpdate && (
        <Tooltip title={t('action.sync')}>
          <Button color="default" variant="link" className="px-0 ml-2" onClick={handleFieldUpdate}>
            <SyncOutlined />
          </Button>
        </Tooltip>
      )}
    </>
  );

  return (
    <>
      <CollapsibleSection
        title={title}
        actions={actions}
        defaultExpanded={true}
        plain
        className={className}
      >
        <div className="p-4 border rounded-xl bg-white">
          <Table
            dataSource={list}
            columns={columns}
            rowKey="id"
            pagination={false}
            className="border rounded"
          />
        </div>
      </CollapsibleSection>

      <FieldInputSetting
        ref={fieldSaveRef}
        type={type}
        agentType={agentType}
        onSave={handleFieldSave}
      />
    </>
  );
}

export default FieldInput;