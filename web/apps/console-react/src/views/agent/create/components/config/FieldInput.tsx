import { Button, Table } from "antd";
import { PlusOutlined, SyncOutlined } from "@ant-design/icons";
import { useRef } from "react";
import { t } from "@/locales";
import { inputTypeList, outputTypeList } from "@/constants/agent";
import { FieldInputSetting, FieldInputSettingRef } from "./FieldInputSetting";
import { SvgIcon } from "@km/shared-components-react";

interface FieldItem {
  id: string;
  variable: string;
  label: string;
  type: string;
  desc?: string;
  required: boolean;
  max_length?: number;
  show_word_limit?: boolean;
  options?: { id: string; label: string; value: string }[];
  multiple?: boolean;
  file_accept?: string[];
  file_limit?: number;
  file_size?: number;
  date_format?: string;
  file_type?: string;
  is_system?: boolean;
}

interface FieldInputProps {
  list: FieldItem[];
  onChange: (list: FieldItem[]) => void;
  title?: string;
  allowUpdate?: boolean;
  allowAdd?: boolean;
  updateRequest?: () => Promise<FieldItem[]>;
  type: "input" | "output";
  agentType?: string;
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
}: FieldInputProps) {
  const fieldSaveRef = useRef<FieldInputSettingRef>(null);

  const getLabel = (fieldType: string) => {
    return [...inputTypeList, ...outputTypeList].find(
      (item) => item.type === fieldType,
    )?.label;
  };

  const handleFieldAdd = () => {
    fieldSaveRef.current?.open({});
  };

  const handleFieldUpdate = async () => {
    const newList: FieldItem[] = await updateRequest();
    const oldList = list.filter((item) => !item.is_system);
    onChange([...oldList, ...newList]);
  };

  const handleFieldEdit = (row: FieldItem) => {
    fieldSaveRef.current?.open(row);
  };

  const handleFieldDelete = (row: FieldItem, index: number) => {
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
      title: t("operation"),
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

  return (
    <>
      <div className="flex items-center gap-1">
        <div className="flex-1 text-base text-primary font-medium mb-3">
          {title}
        </div>
        {allowAdd && (
          <Button type="link" className="px-0" onClick={handleFieldAdd}>
            <PlusOutlined />
            <span>{t("action_add")}</span>
          </Button>
        )}
        {allowUpdate && (
          <Button type="link" className="px-0 ml-2" onClick={handleFieldUpdate}>
            <SyncOutlined />
            <span>{t("action_update")}</span>
          </Button>
        )}
      </div>
      <Table
        dataSource={list}
        columns={columns}
        rowKey="id"
        pagination={false}
        className="border mb-7"
      />

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
