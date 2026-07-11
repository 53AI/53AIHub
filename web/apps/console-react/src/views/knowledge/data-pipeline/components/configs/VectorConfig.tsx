import { useState, useEffect } from "react";
import { Button, Tag, Spin } from "antd";
import {
    InfoCircleFilled,
    SettingOutlined,
    ReloadOutlined,
    WarningFilled,
} from "@ant-design/icons";
import { t } from "@/locales";
import {
    chunkSettingApi,
    type ModelSetting,
} from "@/api/modules/chunk-setting";
import channelApi from "@/api/modules/channel/index";
import { MODEL_USE_TYPE } from "@/constants/platform/config";
import { ModelView } from "@/components/Model/view";
import { SvgIcon } from "@km/shared-components-react";
import { message } from "antd";

export function VectorConfig() {
  const [isLoading, setIsLoading] = useState(false);
  const [vectorEmbedding, setVectorEmbedding] = useState<
    ModelSetting["model_config"]["vector_embedding"] | null
  >(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const vectorValue =
    vectorEmbedding?.channel_id && vectorEmbedding?.model_name
      ? `${vectorEmbedding.channel_id}_53aikm_${vectorEmbedding.model_name}`
      : "";

  const loadTestResult = () => {
    if (!vectorEmbedding?.channel_id || !vectorEmbedding?.model_name) {
      return;
    }
    channelApi
      .test(vectorEmbedding.channel_id, {
        model: vectorEmbedding.model_name,
        model_type: MODEL_USE_TYPE.EMBEDDING,
      })
      .then((res) => {
        setTestResult(res);
      })
      .catch((err) => {
        console.error("Failed to test vector embedding:", err);
        setTestResult(null);
      });
  };

  const loadVectorEmbedding = async () => {
    setIsLoading(true);
    try {
      const data = await chunkSettingApi.modelConfig.get();
      setVectorEmbedding(data.model_config.vector_embedding);
      loadTestResult();
    } catch (error) {
      console.error("Failed to load vector embedding config:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      const data = await chunkSettingApi.modelConfig.get();
      setVectorEmbedding(data.model_config.vector_embedding);
      loadTestResult();
      message.success(t("message_status.refresh_success"));
    } catch (error) {
      console.error("Failed to refresh vector embedding config:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoToModelManagement = () => {
    window.open(
      `${window.location.origin}${window.location.pathname}#/knowledge?tab=model`,
      "_blank",
    );
  };

  useEffect(() => {
    loadVectorEmbedding();
  }, []);

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="bg-[#F5F8FF] p-4 rounded-xl flex items-start gap-3">
        <InfoCircleFilled
          className="text-brand mt-0.5"
          style={{ fontSize: 18 }}
        />
        <div className="flex-1">
          <div className="flex justify-between items-center">
            <div className="text-base font-bold text-primary">
              {t("data_pipeline.vector_global_embedding")}
            </div>
            <Button type="link" loading={isLoading} onClick={handleRefresh}>
              <ReloadOutlined />
              <span className="ml-1">
                {t("data_pipeline.vector_refresh_config")}
              </span>
            </Button>
          </div>
          <p className="text-sm text-placeholder mt-1">
            {t("data_pipeline.vector_embedding_tip")}
          </p>
        </div>
      </div>

      <div className="border border-[#2563EB] rounded-xl p-5 bg-white shadow-sm relative overflow-hidden group">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Spin />
          </div>
        ) : vectorValue ? (
          <div className="flex items-center gap-3 relative z-10">
            <div className="size-[50px] rounded-lg bg-blue-50 flex items-center justify-center shadow-sm">
              <ModelView
                size={40}
                channelId={vectorEmbedding?.channel_id ?? ""}
                model={vectorEmbedding?.model_name ?? ""}
                type="icon"
              />
            </div>
            <div className="flex-1 flex items-center gap-3">
              {/* 正常状态 */}
              {(!testResult || testResult.success) && (
                <div className="flex-1">
                  <span className="font-bold text-sm text-placeholder">
                    <ModelView
                      channelId={vectorEmbedding?.channel_id ?? ""}
                      model={vectorEmbedding?.model_name ?? ""}
                      type="provider_name"
                    />
                  </span>
                  <div className="text-sm text-primary mt-1 font-medium">
                    <ModelView
                      channelId={vectorEmbedding?.channel_id ?? ""}
                      model={vectorEmbedding?.model_name ?? ""}
                      type="model"
                    />
                  </div>
                </div>
              )}

              {/* 异常状态 */}
              {testResult && !testResult.success && (
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-red-500">
                    <WarningFilled />
                    <span className="font-medium">模型配置异常</span>
                  </div>
                  <div className="text-xs text-placeholder mt-1 line-clamp-2">
                    {testResult.message || "请检查模型配置是否正确"}
                  </div>
                </div>
              )}

              {testResult && (
                <Tag color={testResult.success ? "success" : "error"}>
                  {testResult.success
                    ? t("data_pipeline.vector_available")
                    : t("data_pipeline.vector_unavailable")}
                </Tag>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center text-sm text-placeholder">
            {t("data_pipeline.vector_no_config")}
          </div>
        )}
      </div>

      <div className="pt-4 flex justify-center">
        <div
          className="flex items-center gap-2 px-2 py-1 rounded text-sm text-tertiary cursor-pointer hover:bg-blue-50 hover:text-brand transition-all border border-transparent hover:border-blue-100"
          onClick={handleGoToModelManagement}
        >
          <SettingOutlined style={{ color: "#545454" }} />
          <span>{t("data_pipeline.vector_go_model_setting")}</span>
          <SvgIcon name="jump" width={14} height={14} />
        </div>
      </div>
    </div>
  );
}

export default VectorConfig;
