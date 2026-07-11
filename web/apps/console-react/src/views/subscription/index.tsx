import {
  Form,
  Input,
  Button,
  Dropdown,
  Modal,
  Select,
  InputNumber,
  Switch,
  Divider, Tooltip,
  message
} from "antd";
import { PlusOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { useEffect, useState, useRef, useCallback } from "react";
import { t } from "@/locales";
import { subscriptionApi } from "@/api/modules/subscription";
import { SvgIcon } from "@km/shared-components-react";
import SelectPlus from "@/components/SelectPlus";
import { getRealPath, img_host } from "@/utils/config";
import {
  createNewSubscriptionItem,
  transformSubscriptionItemForSave,
} from "./utils";
import type {
  SubscriptionItem,
  UnitOption,
  GroupOptionItem,
} from "@/types/subscription";

// 单位选项
const unitOptions: UnitOption[] = [
  { value: "CNY", label: "CNY" },
  { value: "USD", label: "USD" },
];

export function SubscriptionPage() {
  const [loading, setLoading] = useState(false);
  const [subscriptionList, setSubscriptionList] = useState<SubscriptionItem[]>(
    [],
  );
  const [deletedList, setDeletedList] = useState<SubscriptionItem[]>([]);
  const [transferVisible, setTransferVisible] = useState(false);
  const [originalList, setOriginalList] = useState<SubscriptionItem[]>([]);
  const [form] = Form.useForm();
  const formRef = useRef<any>(null);

  // 刷新数据
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await subscriptionApi.list();
      setSubscriptionList(list);
      setOriginalList(list.map((item: SubscriptionItem) => ({ ...item })));
    } catch (error) {
      console.error("Failed to fetch subscription list:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 添加新订阅项
  const onAdd = useCallback(() => {
    const template = subscriptionList[0];
    if (!template) return;

    const nextIndex = subscriptionList.length + 1;
    const newSubscriptionData = createNewSubscriptionItem(template, nextIndex);
    setSubscriptionList([...subscriptionList, newSubscriptionData]);
  }, [subscriptionList]);

  // 删除订阅项
  const handleRemove = useCallback(
    (data: SubscriptionItem, index: number) => {
      if (data.is_default) return;

      const newItem = { ...data, delete: true };
      if (data.group_id) {
        setDeletedList((prev) => [
          ...prev,
          {
            ...newItem,
            target_group_id: subscriptionList[0]?.group_id,
          },
        ]);
      }

      setSubscriptionList((prev) => prev.filter((_, i) => i !== index));
    },
    [subscriptionList],
  );

  // 图标改变
  const onIconChange = useCallback((value: number, index: number) => {
    setSubscriptionList((prev) => {
      const newList = [...prev];
      newList[index] = {
        ...newList[index],
        logo_url: `${img_host}/subscription/vip-${value}.png`,
      };
      return newList;
    });
  }, []);

  // 格式化选择选项
  const formatSelectOptions = useCallback(
    (list: SubscriptionItem[]): GroupOptionItem[] => {
      return list.map((item: SubscriptionItem) => ({
        value: item.group_id,
        label: item.group_name,
        icon: item.logo_url,
      }));
    },
    [],
  );

  // 提交数据
  const handleSubmit = useCallback(async () => {
    try {
      const items = subscriptionList.map(
        (item: SubscriptionItem, index: number) =>
          transformSubscriptionItemForSave(
            item,
            index,
            subscriptionList.length,
          ),
      );

      if (deletedList.length) {
        items.push(...deletedList);
      }
      setTransferVisible(false);
      await subscriptionApi.save({ data: { items } });
      message.success(t("action_save_success"));
      setDeletedList([]);
      await refresh();
    } catch (error) {
      console.error("Save failed:", error);
      message.error(t("action_save_failed"));
    }
  }, [subscriptionList, deletedList, refresh]);

  // 处理保存
  const handleSave = useCallback(async () => {
    try {
      await form.validateFields();

      if (deletedList.length) {
        setTransferVisible(true);
        return;
      }
      handleSubmit();
    } catch (error) {
      console.error("Validation failed:", error);
    }
  }, [deletedList, handleSubmit, form]);

  // 数字输入处理
  const numberInputKeydownHandler = useCallback((event: KeyboardEvent) => {
    const allowedKeys = [
      "Backspace",
      "Delete",
      "Tab",
      "Enter",
      "ArrowLeft",
      "ArrowRight",
      ".",
    ];

    if (
      !allowedKeys.includes(event.key) &&
      !(event.key >= "0" && event.key <= "9") &&
      !(event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
    }
  }, []);

  // 取消操作
  const handleCancel = useCallback(() => {
    setTransferVisible(false);
    setDeletedList([]);
    setSubscriptionList(
      originalList.map((item: SubscriptionItem) => ({ ...item })),
    );
  }, [originalList]);

  // 更新订阅项字段
  const updateSubscriptionItem = useCallback(
    (index: number, updates: Partial<SubscriptionItem>) => {
      setSubscriptionList((prev) => {
        const newList = [...prev];
        newList[index] = { ...newList[index], ...updates };
        return newList;
      });
    },
    [],
  );

  // 更新嵌套字段 (year_info, month_info, point_month_info)
  const updatePricingInfo = useCallback(
    (
      index: number,
      field: "year_info" | "month_info" | "point_month_info",
      updates: Partial<SubscriptionItem["year_info"]>,
    ) => {
      setSubscriptionList((prev) => {
        const newList = [...prev];
        newList[index] = {
          ...newList[index],
          [field]: { ...newList[index][field], ...updates },
        };
        return newList;
      });
    },
    [],
  );

  // 生命周期
  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="h-full flex flex-col px-2 relative overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col bg-white box-border overflow-auto">
        <h1 className="flex-none text-base text-secondary">
          {t("module.subscription_header_title")}
        </h1>
        <div className="overflow-x-auto mt-5 pb-1 pr-1">
          <Form
            ref={formRef}
            form={form}
            className="min-h-[70vh] overflow-hidden flex gap-4 w-max"
            layout="vertical"
          >
            {subscriptionList.map((item, index) => (
              <div
                key={index}
                className="flex-none w-[334px] bg-[#F9F9FC] p-4 box-border"
              >
                {/* 图标 + 名称 + 删除按钮 */}
                <Form.Item>
                  <div className="w-full flex items-center gap-2.5">
                    <Dropdown
                      menu={{
                        items: [1, 2, 3, 4, 5].map((i) => ({
                          key: i,
                          label: (
                            <img
                              src={`${img_host}/subscription/vip-${i}.png`}
                              className="w-[36px] h-[36px] object-cover"
                              alt={`VIP ${i}`}
                            />
                          ),
                        })),
                        onClick: ({ key }) => onIconChange(Number(key), index),
                      }}
                      trigger={["click"]}
                    >
                      <img
                        src={
                          !/\.png$/.test(item.logo_url)
                            ? getRealPath(
                                `/images/subscription/${item.logo_url}.png`,
                              )
                            : item.logo_url
                        }
                        className="flex-none w-[36px] h-[36px] object-cover cursor-pointer"
                        alt={t("module.subscription_icon")}
                      />
                    </Dropdown>
                    <Form.Item
                      className="flex-1 mb-0"
                      name={`${index}.group_name`}
                      rules={[
                        {
                          required: true,
                          message: t("form_input_placeholder"),
                        },
                      ]}
                      initialValue={item.group_name}
                    >
                      <Input
                        value={item.group_name}
                        onChange={(e) =>
                          updateSubscriptionItem(index, {
                            group_name: e.target.value,
                          })
                        }
                        placeholder={t("form_input_placeholder")}
                        showCount
                        maxLength={10}
                      />
                    </Form.Item>
                    <SvgIcon
                      name="delete"
                      className="flex-none cursor-pointer"
                      style={{
                        visibility: item.is_default ? "hidden" : "visible",
                        color: "#F04F4D",
                        fontSize: 16,
                      }}
                      size={16}
                      onClick={() => handleRemove(item, index)}
                    />
                  </div>
                </Form.Item>

                {/* 年费设置 */}
                <Form.Item label={t("module.subscription_charge")}>
                  <div className="w-full flex items-center gap-2">
                    <Select
                      value={item.year_info?.currency}
                      onChange={(value) =>
                        updatePricingInfo(index, "year_info", {
                          currency: value,
                        })
                      }
                      className="flex-none !w-[86px]"
                      options={unitOptions}
                    />
                    <InputNumber
                      value={item.year_info?.amount}
                      onChange={(value) =>
                        updatePricingInfo(index, "year_info", { amount: value })
                      }
                      className="charge-point-input flex-1"
                      controls={false}
                      precision={2}
                      min={0}
                      max={999999999999}
                      disabled={item.is_default}
                      placeholder={t("form_input_placeholder")}
                      onKeyDown={numberInputKeydownHandler}
                    />
                    <div className="flex-none text-sm text-primary">
                      /{t("year")}
                    </div>
                  </div>

                  {/* 月费设置 */}
                  <div className="mt-3 w-full flex items-center gap-2">
                    <Select
                      value={item.month_info?.currency}
                      onChange={(value) =>
                        updatePricingInfo(index, "month_info", {
                          currency: value,
                        })
                      }
                      className="flex-none !w-[86px]"
                      options={unitOptions}
                    />
                    <InputNumber
                      value={item.month_info?.amount}
                      onChange={(value) =>
                        updatePricingInfo(index, "month_info", {
                          amount: value,
                        })
                      }
                      className="charge-point-input flex-1"
                      controls={false}
                      precision={2}
                      min={0}
                      max={999999999999}
                      disabled={item.is_default}
                      placeholder={t("form_input_placeholder")}
                      onKeyDown={numberInputKeydownHandler}
                    />
                    <div className="flex-none text-sm text-primary">
                      /{t("monthly")}
                    </div>
                  </div>
                </Form.Item>

                {/* 积分设置 */}
                <Form.Item label={t("module.subscription_points")}>
                  <div className="w-full flex items-center gap-2">
                    <InputNumber
                      value={item.point_month_info?.amount}
                      onChange={(value) =>
                        updatePricingInfo(index, "point_month_info", {
                          amount: value,
                        })
                      }
                      className="charge-point-input flex-1"
                      controls={false}
                      precision={0}
                      min={0}
                      max={999999999999}
                      placeholder={t("form_input_placeholder")}
                      onKeyDown={numberInputKeydownHandler}
                    />
                    <div className="flex-none text-sm text-primary">
                      /{t("monthly")}
                    </div>
                  </div>
                </Form.Item>

                <Divider />

                {/* Agent 列表 */}
                {item.agents && item.agents.length > 0 && (
                  <>
                    <Form.Item
                      className="!mb-0"
                      label={t("module.subscription_agent_bots")}
                    >
                      {item.agents.map((agent, agentIndex) => (
                        <div
                          key={agentIndex}
                          className="w-full flex items-center gap-2 mb-3"
                        >
                          <img
                            src={agent.logo}
                            className="flex-none w-[18px] h-[18px] object-contain rounded-full overflow-hidden"
                            alt={agent.name}
                          />
                          <div className="flex-1 truncate text-sm text-secondary">
                            {agent.name}
                          </div>
                        </div>
                      ))}
                    </Form.Item>
                    <Divider />
                  </>
                )}

                {/* AI 助手设置 */}
                <Form.Item className="!mb-0">
                  <div className="flex items-center gap-1 mb-2">
                    <span>{t("module.subscription_ai_assistant")}</span>
                    <Tooltip
                      title={t("module.subscription_ai_assistant_tip")}
                      placement="bottom"
                    >
                      <QuestionCircleOutlined
                        className="flex-none cursor-pointer"
                        style={{ color: "#A0A7B8", fontSize: 14 }}
                      />
                    </Tooltip>
                    <div className="flex-1"></div>
                    <Switch
                      checked={item.ai_enabled}
                      onChange={(checked) =>
                        updateSubscriptionItem(index, { ai_enabled: checked })
                      }
                      size="small"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      className="!p-2"
                      type="default"
                      disabled={!item.ai_enabled}
                    >
                      <SvgIcon
                        className="mr-1.5"
                        name="windows"
                        width={14}
                        height={14}
                        style={{ opacity: item.ai_enabled ? 1 : 0.5 }}
                      />
                      <span className="text-xs">Windows</span>
                    </Button>
                    <Button
                      className="!p-2 !ml-0"
                      type="default"
                      disabled={!item.ai_enabled}
                    >
                      <SvgIcon
                        className="mr-1.5"
                        name="ios"
                        width={14}
                        height={14}
                        style={{ opacity: item.ai_enabled ? 1 : 0.5 }}
                      />
                      <span className="text-xs">macOS</span>
                    </Button>
                    <Button
                      className="!p-2 !ml-0"
                      type="default"
                      disabled={!item.ai_enabled}
                    >
                      <SvgIcon
                        className="mr-1.5"
                        name="chrome"
                        width={14}
                        height={14}
                        style={{ opacity: item.ai_enabled ? 1 : 0.5 }}
                      />
                      <span className="text-xs">Google</span>
                    </Button>
                  </div>
                </Form.Item>
              </div>
            ))}

            {/* 添加按钮 */}
            {subscriptionList.length < 5 && (
              <div
                className="flex-none w-[200px] bg-[#F9F9FC] flex items-center justify-center p-4 box-border cursor-pointer hover:opacity-70 transition-opacity"
                onClick={onAdd}
              >
                <PlusOutlined style={{ fontSize: 16, color: "#4F5052" }} />
              </div>
            )}
          </Form>
        </div>
      </div>

      {/* 底部保存栏 */}
      {!loading && (
        <div className="sticky bottom-0 left-0 right-0 z-10 bg-[#fff]">
          <div className="bg-white px-2">
            <Divider />
            <Button type="primary" onClick={handleSave}>
              {t("action_save")}
            </Button>
          </div>
        </div>
      )}

      {/* 转移对话框 */}
      <Modal
        open={transferVisible}
        title={t("subscription.transfer_title")}
        width={480}
        onCancel={handleCancel}
        footer={[
          <Button key="cancel" onClick={handleCancel}>
            {t("action_cancel")}
          </Button>,
          <Button key="confirm" type="primary" onClick={handleSubmit}>
            {t("action_confirm")}
          </Button>,
        ]}
      >
        <p className="text-sm text-secondary">
          {t("subscription.transfer_desc")}
        </p>
        {deletedList.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2 mt-4">
            <div className="flex-1">
              <SelectPlus
                value={item.group_id}
                options={formatSelectOptions(deletedList)}
                disabled
              />
            </div>
            <div className="text-sm text-secondary mx-3">
              {t("subscription.transfer_to")}
            </div>
            <div className="flex-1">
              <SelectPlus
                value={item.target_group_id}
                options={formatSelectOptions(subscriptionList)}
                onChange={(value) => {
                  setDeletedList((prev) => {
                    const newList = [...prev];
                    newList[idx] = {
                      ...newList[idx],
                      target_group_id: value as number,
                    };
                    return newList;
                  });
                }}
              />
            </div>
          </div>
        ))}
        <div className="h-5"></div>
      </Modal>
    </div>
  );
}

export default SubscriptionPage;
