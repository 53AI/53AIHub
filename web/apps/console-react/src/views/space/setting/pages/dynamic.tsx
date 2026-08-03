import { useState } from "react";
import { Input, Button, Modal } from "antd";
import { Header } from "@/components/Header";
import { t } from "@/locales";
import {
  FileTextOutlined,
  PlusOutlined,
  CloseOutlined,
  DeleteOutlined,
} from "@ant-design/icons";

const MOCK_TYPES = [
  { id: "1", name: "客户" },
  { id: "2", name: "商机" },
  { id: "3", name: "会议" },
  { id: "4", name: "解决方案" },
  { id: "5", name: "产品功能" },
  { id: "6", name: "案例" },
];

const INITIAL_CONFIGS: Record<string, any[]> = {
  "1": [
    { id: "c1", title: "公司概况", description: "", rule: "" },
    { id: "c2", title: "业绩说明", description: "", rule: "" },
    { id: "c3", title: "诉讼事项", description: "", rule: "" },
    { id: "c4", title: "公司概况", description: "", rule: "" },
    { id: "c5", title: "公司产品", description: "", rule: "" },
  ],
};

export function DynamicPage() {
  const [selectedTypeId, setSelectedTypeId] = useState("1");
  const [configsMap, setConfigsMap] = useState(INITIAL_CONFIGS);
  const [selectedConfigId, setSelectedConfigId] = useState("c1");

  const currentConfigs = configsMap[selectedTypeId] || [];
  const selectedConfig = currentConfigs.find((c) => c.id === selectedConfigId);

  const handleTypeSelect = (id: string) => {
    setSelectedTypeId(id);
    const configs = configsMap[id] || [];
    if (configs.length > 0) {
      setSelectedConfigId(configs[0].id);
    } else {
      setSelectedConfigId("");
    }
  };

  const handleAddConfig = () => {
    const newId = `c${Date.now()}`;
    const newConfig = {
      id: newId,
      title: t("space.dynamic.new_config"),
      description: "",
      rule: "",
    };

    setConfigsMap((prev) => {
      const list = prev[selectedTypeId] || [];
      return {
        ...prev,
        [selectedTypeId]: [...list, newConfig],
      };
    });
    setSelectedConfigId(newId);
  };

  const handleDeleteConfig = (id: string) => {
    setConfigsMap((prev) => {
      const list = prev[selectedTypeId] || [];
      const newList = list.filter((c) => c.id !== id);
      return {
        ...prev,
        [selectedTypeId]: newList,
      };
    });
    if (selectedConfigId === id) {
      setSelectedConfigId("");
    }
  };

  const updateConfig = (id: string, field: string, value: string) => {
    setConfigsMap((prev) => {
      const list = prev[selectedTypeId] || [];
      const newList = list.map((c) =>
        c.id === id ? { ...c, [field]: value } : c,
      );
      return {
        ...prev,
        [selectedTypeId]: newList,
      };
    });
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden px-[78px] bg-white">
      <Header className="pt-8 pb-5" title={t("space.setting.menu.dynamic")} />

      <div className="flex-1 overflow-hidden mb-5 rounded-lg border border-gray-200 flex flex-row">
        {/* Left Panel: Knowledge Types */}
        <div className="w-[220px] flex flex-col border-r border-gray-100 bg-white">
          <div className="h-2"></div>
          <div className="h-11 px-5 flex items-center text-sm font-medium text-[#373A3D]">
            {t("space.dynamic.knowledge_type")}
          </div>
          <div className="flex-1 overflow-y-auto">
            {MOCK_TYPES.map((type) => (
              <div
                key={type.id}
                className={`group h-10 flex items-center justify-between px-7 cursor-pointer text-sm transition-colors text-primary ${
                  selectedTypeId === type.id
                    ? "bg-[#EEEFF0] "
                    : " hover:bg-gray-100"
                }`}
                onClick={() => handleTypeSelect(type.id)}
              >
                <div className="flex items-center">
                  <FileTextOutlined className="mr-2" />
                  {type.name}
                </div>
                <DeleteOutlined
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500"
                  onClick={(e) => {
                    e.stopPropagation();
                    Modal.confirm({
                      title: t("space.dynamic.delete_type_confirm"),
                      content: t("space.dynamic.delete_type_warning"),
                      okText: t("action.confirm"),
                      cancelText: t("action.cancel"),
                      onOk() {
                        // 这里后续添加删除逻辑
                        console.log("Delete type:", type.id);
                      },
                      onCancel() {
                        console.log("Cancel delete");
                      },
                    });
                  }}
                />
              </div>
            ))}
          </div>
          <div className="p-4 flex justify-center">
            <Button
              color="primary"
              variant="filled"
              icon={<PlusOutlined className="text-xs" />}
            >
              添加
            </Button>
          </div>
        </div>

        {/* Middle Panel: Page Configurations */}
        <div className="w-[340px] flex flex-col border-r border-gray-100">
          <div className="h-2"></div>
          <div className="h-11 flex items-center px-5 text-sm font-medium text-[#373A3D] border-b">
            {t("space.dynamic.page_config")}
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {currentConfigs.map((config) => (
              <div
                key={config.id}
                className={`h-16 flex items-center justify-center relative border border-dashed rounded-xl text-center cursor-pointer transition-colors ${
                  selectedConfigId === config.id
                    ? "border-[#3B66F5] bg-[#F4F6FE]"
                    : "border-[#AEC0F9] bg-[#FAFBFF] hover:border-[#3B66F5]"
                }`}
                onClick={() => setSelectedConfigId(config.id)}
              >
                <span className="text-sm text-primary">
                  {config.title || t("common.untitled")}
                </span>
                <div
                  className="absolute -top-2 -right-2 w-[18px] h-[18px] bg-[#D1D5DB] text-white rounded-full flex items-center justify-center cursor-pointer hover:bg-gray-400 z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteConfig(config.id);
                  }}
                >
                  <CloseOutlined style={{ fontSize: "10px" }} />
                </div>
              </div>
            ))}
            <div
              className="border border-dashed border-[#AEC0F9] bg-[#FAFBFF] rounded p-4 flex items-center justify-center cursor-pointer hover:border-[#3B66F5] transition-colors"
              onClick={handleAddConfig}
            >
              <div className="w-5 h-5 rounded-full bg-[#3B66F5] text-white flex items-center justify-center">
                <PlusOutlined style={{ fontSize: "12px" }} />
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel: Form */}
        <div className="flex-1 flex flex-col bg-white">
          {selectedConfig ? (
            <div className="p-8 space-y-6 max-w-[600px]">
              <div>
                <div className="mb-2 text-sm text-gray-700">
                  {t("space.dynamic.title")}<span className="text-red-500 ml-1">*</span>
                </div>
                <Input
                  value={selectedConfig.title}
                  onChange={(e) =>
                    updateConfig(selectedConfig.id, "title", e.target.value)
                  }
                  maxLength={50}
                  showCount
                  className="rounded"
                />
              </div>
              <div>
                <div className="mb-2 text-sm text-gray-700">{t("space.dynamic.description")}</div>
                <Input.TextArea
                  value={selectedConfig.description}
                  onChange={(e) =>
                    updateConfig(
                      selectedConfig.id,
                      "description",
                      e.target.value,
                    )
                  }
                  placeholder={t("space.dynamic.description_placeholder")}
                  rows={4}
                  maxLength={100}
                  showCount
                  style={{ resize: "none" }}
                  className="rounded"
                />
              </div>
              <div>
                <div className="mb-2 text-sm text-gray-700">{t("space.dynamic.rule")}</div>
                <Input.TextArea
                  value={selectedConfig.rule}
                  onChange={(e) =>
                    updateConfig(selectedConfig.id, "rule", e.target.value)
                  }
                  placeholder={t("space.dynamic.rule_placeholder")}
                  rows={5}
                  style={{ resize: "none" }}
                  className="rounded"
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              {t("space.dynamic.empty_form_tip")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DynamicPage;
