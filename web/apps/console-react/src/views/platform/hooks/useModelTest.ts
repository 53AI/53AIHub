import { useCallback, useState } from "react";
import { message } from "antd";
import { t } from "@/locales";
import channelApi from "@/api/modules/channel/index";

/** 模型测试结果 */
export interface TestResult {
  loading: boolean;
  success: boolean;
  message: string;
}

/** 可测试模型的通用接口 */
export interface TestableModel {
  channel_id: number;
  model_id: string;
  model_name: string;
  platform_name: string;
  model_type?: string;
  /** 是否为语音模型，语音模型使用 testVoice 接口 */
  isVoice?: boolean;
}

/** 生成测试结果在 map 中的 key */
export const getTestKey = (channelId: number, modelId: string) =>
  `${channelId}-${modelId}`;

/**
 * useModelTest — 模型测试 hook
 * 封装测试状态管理与 channelApi.test 调用
 *
 * 用法：
 *   const { testMap, handleModelTest } = useModelTest();
 *   // JSX:
 *   <Button loading={testMap[getTestKey(ch.id, m.id)]?.loading} onClick={() => handleModelTest(m)} />
 *   {testMap[getTestKey(ch.id, m.id)]?.success && <Tag color="success">{t("action_test_success")}</Tag>}
 */
export function useModelTest() {
  const [testMap, setTestMap] = useState<Record<string, TestResult>>({});

  const handleModelTest = useCallback(
    async (model: TestableModel) => {
      const key = getTestKey(model.channel_id, model.model_id);
      setTestMap((prev) => ({
        ...prev,
        [key]: { loading: true, success: false, message: "" },
      }));

      const testPromise = model.isVoice
        ? channelApi.testVoice(model.channel_id, model.model_id)
        : channelApi.test(model.channel_id, {
            model: model.model_id,
            model_type: model.model_type,
          });

      return testPromise
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
                platform: `${model.platform_name} ${model.model_name}`,
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
    [],
  );

  return { testMap, handleModelTest };
}
