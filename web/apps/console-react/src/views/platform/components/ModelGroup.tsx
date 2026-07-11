import { useState, useMemo, useCallback } from "react";
import { Button, Collapse, Tag, Tooltip, message } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { t } from "@/locales";
import channelApi from "@/api/modules/channel/index";
import type { ChannelGroup, ModelTypeEntry } from "../Model";

interface ModelGroupProps {
  group: ChannelGroup;
  onEdit: (data: any) => void;
  onAdd: (data: any) => void;
  onDelete: (data: any, model: any) => void;
  onModelEdit: (data: { data: any; parentData: any }) => void;
}

interface TestResult {
  loading: boolean;
  success: boolean;
  message: string;
}

export function ModelGroup({
  group,
  onEdit,
  onAdd,
  onDelete,
  onModelEdit,
}: ModelGroupProps) {
  const [testMap, setTestMap] = useState<Record<string, TestResult>>({});

  const defaultActiveKey = useMemo(() => {
    if (group.multiple) {
      return group.group.map((_, index) => `models-${index}`);
    }
    return group.modelValue;
  }, [group.multiple, group.modelValue, group.group]);

  const [activeKey, setActiveKey] = useState<string[]>(defaultActiveKey);

  const primary = useMemo(() => group.items[0], [group.items]);

  const channelFor = useCallback(
    (model: Record<string, unknown>, entry: ModelTypeEntry) => {
      return (model.source ?? entry.source ?? primary) as any;
    },
    [primary],
  );

  const getTestKey = useCallback((data: any, model: any) => {
    return `${data.channel_id}-${model.value}`;
  }, []);

  const getTestResult = useCallback(
    (data: any, model: any) => {
      return testMap[getTestKey(data, model)];
    },
    [testMap, getTestKey],
  );

  const handleTest = useCallback(
    (model: any, data: any) => {
      const key = getTestKey(data, model);
      setTestMap((prev) => ({
        ...prev,
        [key]: { loading: true, success: false, message: "" },
      }));

      return channelApi
        .test(data.channel_id, {
          model: model.value,
          model_type: model.modelType,
        })
        .then((res) => {
          const success = res ? res.success : false;
          const messageText = res ? res.message : "";
          setTestMap((prev) => ({
            ...prev,
            [key]: {
              loading: false,
              success,
              message: messageText,
            },
          }));
          if (success) {
            message.success(
              t("platform.model_test_success", {
                platform: `${data.platform_name} ${model.value}`,
              }),
            );
          } else {
            message.error(
              `${t("platform.model_test_failed")}${messageText ? ` (${messageText})` : ""}`,
            );
          }
        })
        .catch((e) => {
          const errorMessage = e.message || "";
          setTestMap((prev) => ({
            ...prev,
            [key]: { loading: false, success: false, message: errorMessage },
          }));
          message.error(
            `${t("platform.model_test_failed")}${errorMessage ? ` (${errorMessage})` : ""}`,
          );
        });
    },
    [getTestKey],
  );

  const handleSettingClick = useCallback(
    (model: Record<string, unknown>, entry: ModelTypeEntry) => {
      const channel = channelFor(model, entry);
      if (group.multiple) {
        onEdit(channel);
      } else {
        onModelEdit({ data: model, parentData: primary });
      }
    },
    [channelFor, group.multiple, onEdit, onModelEdit, primary],
  );

  const handleDeleteClick = useCallback(
    (model: Record<string, unknown>, entry: ModelTypeEntry) => {
      const channel = channelFor(model, entry);
      onDelete(
        channel,
        group.multiple && channel.models.length === 1 ? null : model,
      );
    },
    [channelFor, group.multiple, onDelete, primary],
  );

  return (
    <li className="w-full px-5 border rounded box-border overflow-hidden bg-white">
      <div className="h-14 flex items-center gap-3 border-b border-[#F7F8FA]">
        <img
          className="flex-none w-6 h-6 object-contain rounded-md overflow-hidden"
          src={primary.platform_icon}
          alt=""
        />
        <div className="flex-1 text-dark font-semibold">
          {primary.platform_name}
        </div>
        {!group.multiple ? (
          <Button className="flex-none !px-3" onClick={() => onEdit(primary)}>
            {t("action_setting")}
          </Button>
        ) : (
          <Button className="flex-none !px-3" onClick={() => onAdd(primary)}>
            {t("action_add")}
          </Button>
        )}
        <Button
          className="flex-none !ml-0 !px-2"
          onClick={() => onDelete(primary, null)}
        >
          <SvgIcon name="delete" size={14} />
        </Button>
      </div>

      <div className="w-full flex flex-col bg-white rounded overflow-hidden gap-4 mt-0.5 pb-5">
        <Collapse
          activeKey={activeKey}
          onChange={(keys) => setActiveKey(keys as string[])}
          expandIconPlacement="start"
          ghost
          className="w-full !border-none model-group-collapse"
          items={group.group.map((entry, index) => ({
            key: group.multiple ? `models-${index}` : entry.modelType,
            label: (
              <div className="flex items-center justify-between gap-2">
                <span className="text-primary text-sm">
                  {entry.modelTypeName}
                </span>
                <span className="px-1.5 leading-5 rounded text-placeholder text-xs bg-[#F5F6F7]">
                  {t("module.platform_model_models_total", {
                    total: entry.options.length,
                  })}
                </span>
              </div>
            ),
            children: (
              <ul
                className={`w-full flex flex-col box-border overflow-auto pl-5 ${group.multiple ? "gap-y-5" : "gap-y-0.5"}`}
              >
                {entry.options.map((model) => {
                  const testResult = getTestResult(
                    channelFor(model, entry),
                    model,
                  );
                  return (
                    <li
                      key={model.value}
                      className={`w-full box-border flex items-center gap-2 group ${group.multiple ? "" : "h-10 px-2.5 hover:bg-[#FAFBFC] rounded-md"}`}
                    >
                      {model.icon && (
                        <img
                          className={`flex-none w-5 h-5 object-contain ${group.multiple ? "" : "rounded-full"}`}
                          src={model.icon}
                          alt=""
                        />
                      )}
                      <div className="flex-1 flex items-center gap-1">
                        <label className="text-sm text-primary">
                          {model.label}
                        </label>
                        {model.label !== model.value && (
                          <>
                            <span className="text-placeholder text-xs">|</span>
                            <span className="text-placeholder text-xs">
                              {model.value}
                            </span>
                          </>
                        )}

                        {model.deep_thinking && (
                          <Tooltip title={t("model.deep_thinking")}>
                            <div className="w-5 h-5 rounded flex items-center justify-center bg-[#EDF3FF] text-brand">
                              <SvgIcon
                                name="smart-optimization"
                                width="12"
                              ></SvgIcon>
                            </div>
                          </Tooltip>
                        )}
                        {model.vision && (
                          <Tooltip title={t("platform_model.vision")}>
                            <div className="w-5 h-5 rounded flex items-center justify-center bg-[#FFF9ED] text-[#F0A105]">
                              <SvgIcon name="preview-open" width="12"></SvgIcon>
                            </div>
                          </Tooltip>
                        )}
                        {testResult && (
                          <>
                            {!testResult.loading &&
                              (testResult.success ? (
                                <Tag color="success">
                                  {t("action_test_success")}
                                </Tag>
                              ) : (
                                <Tag color="error">
                                  {t("action_test_failed")}
                                </Tag>
                              ))}
                          </>
                        )}
                      </div>

                      <div
                        className={`flex items-center gap-2 group-hover:visible invisible ${group.multiple ? "flex-1 gap-1" : "gap-2"}`}
                      >
                        {group.multiple && <div className="flex-1" />}
                        <Tooltip title={t("action_test")}>
                          <Button
                            type="link"
                            className="px-0"
                            loading={testResult?.loading}
                            onClick={() =>
                              handleTest(model, channelFor(model, entry))
                            }
                          >
                            <SvgIcon name="tool" width="14"></SvgIcon>
                          </Button>
                        </Tooltip>
                        <Tooltip title={t("action_setting")}>
                          <span
                            className={`${group.multiple ? "flex-none" : ""} cursor-pointer text-placeholder`}
                            onClick={() => handleSettingClick(model, entry)}
                          >
                            <SvgIcon name="config" width="14"></SvgIcon>
                          </span>
                        </Tooltip>
                        <Tooltip title={t("action_delete")}>
                          <span
                            className={`${group.multiple ? "flex-none" : ""} cursor-pointer text-placeholder`}
                            onClick={() => handleDeleteClick(model, entry)}
                          >
                            <SvgIcon name="delete" width="14"></SvgIcon>
                          </span>
                        </Tooltip>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ),
          }))}
        />
      </div>
    </li>
  );
}

export default ModelGroup;
