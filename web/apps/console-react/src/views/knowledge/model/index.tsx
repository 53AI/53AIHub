import { useEffect, useState, useCallback, useRef } from "react";
import { Form, Button, message, Spin, Modal, Input } from "antd";
import { ExclamationCircleFilled } from "@ant-design/icons";
import { t } from "@/locales";
import { ModelSelect } from "@/components/Model/select";
import {
  chunkSettingApi,
  type ModelSetting,
} from "@/api/modules/chunk-setting";
import { MODEL_USE_TYPE, REASONING_MODE } from "@/constants/platform/config";
import { debounce } from "@/directive/debounce";

// Default setting template
const defaultSetting: ModelSetting = {
  created_time: 1672502400,
  eid: 1,
  file_id: 1,
  id: 1,
  library_id: 1,
  model_config: {
    version: "string",
    logic_reasoning: {
      channel_id: 0,
      model_name: "",
    },
    vector_embedding: {
      channel_id: 0,
      model_name: "",
    },
    fast_reasoning: {
      channel_id: 0,
      model_name: "",
    },
    search_config: {
      vector: true,
      fulltext: false,
      hybrid: false,
      rerank_model: "reranking_model",
      rerank_channel_id: 0,
      rerank_model_name: "",
      reranking_enable: false,
      top_k: 0,
      score_threshold: 0,
      score_threshold_enabled: false,
      weights: {
        keyword_setting: {
          keyword_weight: 1,
        },
        vector_setting: {
          vector_weight: 0,
        },
      },
    },
  },
  updated_time: 1672502400,
};

// Helper: encode channel_id and model_name to value
const encodeModelValue = (
  channel_id: number | null,
  model_name: string | null,
): string => {
  return channel_id && model_name ? `${channel_id}_53aikm_${model_name}` : "";
};

// Helper: decode value to channel_id and model_name
const decodeModelValue = (
  value: string,
): { channel_id: number; model_name: string } => {
  if (!value) {
    return { channel_id: 0, model_name: "" };
  }
  const [channel_id, model_name] = value.split("_53aikm_");
  return {
    channel_id: Number(channel_id),
    model_name: model_name || "",
  };
};

interface KnowledgeModelProps {
  /** 当前活跃的 Tab key，用于判断是否需要重置状态 */
  activeTab?: string;
}

export function KnowledgeModel({ activeTab }: KnowledgeModelProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [setting, setSetting] = useState<ModelSetting>(() => ({
    ...defaultSetting,
    model_config: { ...defaultSetting.model_config },
  }));
  // 初始加载的向量嵌入模型值，用于判断是否修改
  const [initialVectorEmbedding, setInitialVectorEmbedding] = useState<{
    channel_id: number;
    model_name: string;
  }>({ channel_id: 0, model_name: "" });

  // 追踪是否是当前活跃的 Tab
  const isActive = activeTab === "model";
  const wasActiveRef = useRef(isActive);

  // Computed values for model selects
  const logicValue = encodeModelValue(
    setting.model_config.logic_reasoning.channel_id,
    setting.model_config.logic_reasoning.model_name,
  );

  const fastReasoningValue = encodeModelValue(
    setting.model_config.fast_reasoning.channel_id,
    setting.model_config.fast_reasoning.model_name,
  );

  const vectorValue = encodeModelValue(
    setting.model_config.vector_embedding.channel_id,
    setting.model_config.vector_embedding.model_name,
  );

  // Handlers
  const handleLogicChange = useCallback((value: string) => {
    const { channel_id, model_name } = decodeModelValue(value);
    setSetting((prev) => ({
      ...prev,
      model_config: {
        ...prev.model_config,
        logic_reasoning: { channel_id, model_name },
      },
    }));
  }, []);

  const handleFastReasoningChange = useCallback((value: string) => {
    const { channel_id, model_name } = decodeModelValue(value);
    setSetting((prev) => ({
      ...prev,
      model_config: {
        ...prev.model_config,
        fast_reasoning: { channel_id, model_name },
      },
    }));
  }, []);

  const handleVectorChange = useCallback((value: string) => {
    const { channel_id, model_name } = decodeModelValue(value);
    setSetting((prev) => ({
      ...prev,
      model_config: {
        ...prev.model_config,
        vector_embedding: { channel_id, model_name },
      },
    }));
  }, []);

  // Check if vector embedding model has changed
  // 第一次选择向量模型（从空变为有值）不需要弹出确认框
  const isVectorEmbeddingChanged = () => {
    const current = setting.model_config.vector_embedding;
    if (
      initialVectorEmbedding.channel_id === 0 &&
      initialVectorEmbedding.model_name === ""
    ) {
      return false;
    }
    // 只有当初始值不为空，且当前值与初始值不同时，才算修改
    return (
      current.channel_id !== initialVectorEmbedding.channel_id ||
      current.model_name !== initialVectorEmbedding.model_name
    );
  };

  // Load config
  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await chunkSettingApi.modelConfig.get();
      const { search_config } = data.model_config;

      // Set default rerank_model if empty
      if (search_config.rerank_model === "") {
        search_config.rerank_model = "reranking_model";
      }

      setSetting(data);
      // 保存初始向量嵌入模型值
      setInitialVectorEmbedding({
        channel_id: data.model_config.vector_embedding.channel_id,
        model_name: data.model_config.vector_embedding.model_name,
      });
    } catch (error) {
      console.error("Failed to load model config:", error);
    } finally {
      setLoading(false);
    }
  };

  // Save config with validation
  const handleSave = async () => {
    // Validation
    if (!logicValue) {
      message.error(t("model.select_model") + t("model.reasoning"));
      return;
    }
    if (!vectorValue) {
      message.error(t("model.select_model") + t("model.embedding"));
      return;
    }
    if (!fastReasoningValue) {
      message.error(t("model.select_model") + t("model.intent_recognition"));
      return;
    }

    // 如果向量嵌入模型修改了，弹出确认框
    if (isVectorEmbeddingChanged()) {
      Modal.confirm({
        title: (
          <div className="flex items-center gap-3">
            <ExclamationCircleFilled className="text-[#fc4d56] text-2xl" />
            <span>{t("model.vector_change_confirm_title")}</span>
          </div>
        ),
        icon: null,
        width: 480,
        content: (
          <div className="py-2 px-9">
            <div className="text-secondary mb-3">{t("model.vector_change_confirm_warning")}</div>
            <p className="text-secondary text-sm mb-2">
              {t("model.vector_change_confirm_hint")}
            </p>
            <Input
              placeholder={t("model.vector_change_confirm_keyword")}
              id="vector-confirm-input"
              className="rounded-md"
            />
          </div>
        ),
        okText: t("action_confirm"),
        cancelText: t("action_cancel"),
        centered: true,
        okButtonProps: {
          danger: true,
        },
        onOk: async () => {
          const input = document.getElementById("vector-confirm-input") as HTMLInputElement;
          const inputValue = input?.value || "";
          if (!inputValue.trim()) {
            message.error(t("model.vector_change_confirm_hint"));
            return Promise.reject();
          }
          if (inputValue !== t("model.vector_change_confirm_keyword")) {
            message.error(t("model.vector_change_confirm_error"));
            return Promise.reject();
          }
          // 确认后执行保存
          await doSave();
        },
      });
      return;
    }

    // 向量嵌入模型未修改，直接保存
    await doSave();
  };

  // 实际执行保存
  const doSave = async () => {
    setSaving(true);
    try {
      await chunkSettingApi.modelConfig.update({
        model_config: setting.model_config,
      });
      message.success(t("message_status.save_success"));
      // 保存成功后更新初始值
      setInitialVectorEmbedding({
        channel_id: setting.model_config.vector_embedding.channel_id,
        model_name: setting.model_config.vector_embedding.model_name,
      });
    } catch (error) {
      console.error("Failed to save model config:", error);
    } finally {
      setSaving(false);
    }
  };

  // Debounced save handler
  const debouncedSave = debounce(handleSave, 1000, true);

  useEffect(() => {
    loadConfig();
  }, []);

  // 当 Tab 从非活跃变为活跃时，重新加载配置（重置未保存的修改）
  useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      // Tab 重新进入，重新加载配置
      loadConfig();
    }
    wasActiveRef.current = isActive;
  }, [isActive]);

  return (
    <div className="h-full  bg-white py-5 px-2 overflow-auto">
      <Spin spinning={loading}>
        <div className="max-w-[600px]">
          <Form layout="vertical">
            <Form.Item label={t("model.reasoning")}>
              <ModelSelect
                value={logicValue}
                onChange={handleLogicChange}
                type={MODEL_USE_TYPE.REASONING}
                placeholder={t("model.select_model")}
              />
            </Form.Item>

            <Form.Item label={t("model.intent_recognition")}>
              <ModelSelect
                value={fastReasoningValue}
                onChange={handleFastReasoningChange}
                type={MODEL_USE_TYPE.REASONING}
                mode={REASONING_MODE.FAST}
                placeholder={t("model.select_model")}
              />
            </Form.Item>

            <Form.Item label={t("model.embedding")}>
              <ModelSelect
                value={vectorValue}
                onChange={handleVectorChange}
                type={MODEL_USE_TYPE.EMBEDDING}
                placeholder={t("model.select_model")}
              />
            </Form.Item>
          </Form>

          <Button
            type="primary"
            className="mt-6"
            loading={saving}
            onClick={debouncedSave}
          >
            {t("action_save")}
          </Button>
        </div>
      </Spin>
    </div>
  );
}

export default KnowledgeModel;
