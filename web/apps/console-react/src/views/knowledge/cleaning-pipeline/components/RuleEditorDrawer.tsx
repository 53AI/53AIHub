import { t } from "@/locales";
import { Drawer, Form, Input, Button, Image, Select } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { IconPopover } from "@/components/Icon/popover";
import { createIconFileFromStatic } from "@km/shared-utils";
import { Editor } from "@km/shared-business/knowledge-pipeline";
import type { Pipeline, EditorRef } from "@km/shared-business/knowledge-pipeline";
import type { Strategy } from "@/api/modules/rag-strategy";

interface RuleEditorDrawerProps {
  visible: boolean;
  currentStep: number;
  editingRule: Partial<Strategy>;
  currentPipeline: Pipeline | null;
  submitting: boolean;
  isEditingDefault: boolean;
  editorRef: React.RefObject<EditorRef | null>;
  lastInputRef: React.RefObject<any>;
  onClose: () => void;
  onNextStep: () => void;
  onPrevStep: () => void;
  onSave: (pipeline: Pipeline) => void;
  onPipelineChange: (pipeline: Pipeline) => void;
  onToggleLogic: () => void;
  onAddCondition: () => void;
  onRemoveCondition: (index: number) => void;
  onUpdateCondition: (index: number, field: string, value: any) => void;
  onRuleChange: React.Dispatch<React.SetStateAction<Partial<Strategy>>>;
  onPipelineUpdate: React.Dispatch<React.SetStateAction<Pipeline | null>>;
}

// Available operators
const getAvailableOperators = (t: (key: string) => string) => [
  { label: t("cleaning_policy.operator_contains"), value: "contains" },
  { label: t("cleaning_policy.operator_eq"), value: "eq" },
  { label: t("cleaning_policy.operator_starts_with"), value: "starts_with" },
  { label: t("cleaning_policy.operator_ends_with"), value: "ends_with" },
];

// Placeholder map
const getPlaceholder = (field: string, t: (key: string) => string) => {
  const keyMap: Record<string, string> = {
    extension: "cleaning_policy.placeholder_extension",
    filename: "cleaning_policy.placeholder_filename",
  };
  return keyMap[field] ? t(keyMap[field]) : "";
};

export function RuleEditorDrawer({
  visible,
  currentStep,
  editingRule,
  currentPipeline,
  submitting,
  isEditingDefault,
  editorRef,
  lastInputRef,
  onClose,
  onNextStep,
  onPrevStep,
  onSave,
  onPipelineChange,
  onToggleLogic,
  onAddCondition,
  onRemoveCondition,
  onUpdateCondition,
  onRuleChange,
  onPipelineUpdate,
}: RuleEditorDrawerProps) {
  const matchers = editingRule.conditions_json?.matchers || [];
  const hasMultipleConditions = matchers.length > 1;
  const canAddCondition = matchers.length < 5;

  // Handle icon params
  const handleIconParams = async (params: { icon: string; bgLight: string; bgDark: string }) => {
    let iconUrl = params.icon;
    if (params.icon && params.bgLight && params.bgDark) {
      const file = await createIconFileFromStatic(
        params.icon, params.bgLight, params.bgDark,
        { size: 100, iconPadding: 24, radius: 10 }
      );
      iconUrl = URL.createObjectURL(file);
    }
    onRuleChange((prev) => ({ ...prev, icon: iconUrl }));
    onPipelineUpdate((prev) => prev ? { ...prev, icon: iconUrl } : prev);
  };

  const drawerTitle = currentStep === 0
    ? isEditingDefault
      ? t("cleaning_policy.edit_fallback_rule")
      : editingRule.id
        ? t("action.edit")
        : t("action.add")
    : (
      <div className="flex items-center gap-3">
        {editingRule?.icon && (
          <img src={editingRule.icon} className="size-8 object-contain" alt="logo" />
        )}
        <span>{editingRule.name}</span>
      </div>
    );

  return (
    <Drawer
      open={visible}
      title={drawerTitle}
      onClose={onClose}
      destroyOnHidden
      width={1200}
      styles={{ body: { padding: currentStep === 0 ? 24 : 0 } }}
      footer={
        currentStep === 0 ? (
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>{t("action.cancel")}</Button>
            <Button type="primary" onClick={onNextStep}>{t("action.next")}</Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button onClick={onPrevStep}>{t("action.prev")}</Button>
            <Button
              type="primary"
              loading={submitting}
              onClick={() => {
                if (editorRef.current?.validate() && currentPipeline) {
                  onSave(currentPipeline);
                }
              }}
            >
              {t("action.save")}
            </Button>
          </div>
        )
      }
    >
      {/* Step 1: Rule Configuration */}
      {currentStep === 0 && (
        <Form layout="vertical">
          {/* Logo and Name */}
          <div className="flex items-start gap-4">
            <IconPopover
              value={editingRule.icon || ''}
              showBg
              onIconParams={handleIconParams}
            >
              <div className="size-[60px] border border-gray-200 rounded-lg flex items-center justify-center shadow-sm cursor-pointer transition-all hover:shadow-md">
                {editingRule.icon ? (
                  <Image
                    className="size-[60px]"
                    src={editingRule.icon}
                    alt="logo"
                    preview={false}
                    style={{ objectFit: 'contain' }}
                  />
                ) : (
                  <PlusOutlined className="text-gray-300 text-xl" />
                )}
              </div>
            </IconPopover>

            <Form.Item className="flex-1" label="名称" required>
              <Input
                value={editingRule.name}
                onChange={(e) => onRuleChange((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="请输入名称"
                maxLength={20}
                showCount
              />
            </Form.Item>
          </div>

          {/* Conditions */}
          {!isEditingDefault && (
            <Form.Item label={t("cleaning_policy.when_condition")}>
              <div className="relative w-full">
                {/* Logic operator */}
                {hasMultipleConditions && (
                  <div className="absolute top-0 -left-3 bottom-0 flex flex-col items-center">
                    <div className="h-full relative flex items-center mr-3">
                      <div
                        className="absolute z-[1] right-[6%] top-8 w-3 rounded-l border-t border-b border-l border-gray-200"
                        style={{ height: "calc(100% - 3.2rem)" }}
                      />
                      <div className="relative z-[9] py-1.5 bg-white">
                        <Button type="primary" ghost size="small" icon={<ReloadOutlined />} onClick={onToggleLogic}>
                          {editingRule.logic === 2 ? t("cleaning_policy.or") : t("cleaning_policy.and")}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                <div className={`space-y-4 ${hasMultipleConditions ? "ml-12" : ""}`}>
                  {matchers.map((cond, index) => (
                    <div key={index} className="relative flex items-center gap-2 group">
                      <div className="flex-1 flex items-center gap-2 bg-gray-50 p-3 rounded-lg border border-transparent hover:border-blue-200 hover:bg-white hover:shadow-sm transition-all">
                        <Select
                          value={cond.type}
                          onChange={(val) => onUpdateCondition(index, "type", val)}
                          style={{ width: 112 }}
                          options={[
                            { label: t("cleaning_policy.field_extension"), value: "extension" },
                            { label: t("cleaning_policy.field_filename"), value: "filename" },
                          ]}
                        />
                        <Select
                          value={cond.operator}
                          onChange={(val) => onUpdateCondition(index, "operator", val)}
                          style={{ width: 112 }}
                          options={getAvailableOperators(t)}
                        />
                        <Input
                          value={cond.value}
                          onChange={(e) => onUpdateCondition(index, "value", e.target.value)}
                          placeholder={getPlaceholder(cond.type, t)}
                          onPressEnter={onAddCondition}
                          className="flex-1"
                          ref={index === matchers.length - 1 ? lastInputRef : undefined}
                        />
                        {hasMultipleConditions && (
                          <Button
                            type="text"
                            danger
                            icon={<SvgIcon name="delete" />}
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => onRemoveCondition(index)}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add button */}
                {canAddCondition && (
                  <div className={`flex items-center gap-2 mt-2 ${hasMultipleConditions ? "ml-10" : ""}`}>
                    <Button type="primary" ghost onClick={onAddCondition}>
                      + {t("cleaning_policy.add_condition")}
                    </Button>
                    <span className="text-gray-400 ml-1">{t("cleaning_policy.max_conditions_tip")}</span>
                  </div>
                )}
              </div>
            </Form.Item>
          )}
        </Form>
      )}

      {/* Step 2: Pipeline Configuration */}
      {currentStep === 1 && currentPipeline && (
        <Editor ref={editorRef} pipeline={currentPipeline} onChange={onPipelineChange} />
      )}
    </Drawer>
  );
}

export default RuleEditorDrawer;
