import { useState, useRef, useCallback, useMemo } from "react";
import { Modal, message } from "antd";
import { t } from "@/locales";
import { ragStrategyApi, ragPipelineApi, uploadApi } from "@/api";
import type { Strategy } from "@/api/modules/rag-strategy";
import { createNewPipeline, DEFAULT_PIPELINE_STEP } from "@km/shared-business/knowledge-pipeline";
import type { Pipeline, EditorRef } from "@km/shared-business/knowledge-pipeline";
import { api_host } from "@/utils/config";

// Default rule template
const DEFAULT_RULE: Partial<Strategy> = {
  name: "",
  icon: "",
  priority: 10,
  logic: 1,
  enabled: true,
  pipeline_id: "",
  pipeline_name: "",
  conditions_json: {
    matchers: [{ type: "extension", operator: "eq", value: "" }],
  },
};

/**
 * 上传图标 - 处理 blob URL 转换为服务器 URL
 */
const uploadIconIfNeeded = async (icon: string): Promise<string> => {
  if (!icon) return "";
  // 如果是 blob URL，需要上传
  if (icon.startsWith("blob:")) {
    try {
      const blob = await fetch(icon).then((res) => res.blob());
      const file = new File([blob], "icon.png", { type: "image/png" });
      const res = await uploadApi.upload(file);
      // 添加空指针保护
      const previewKey = res?.data?.preview_key;
      if (!previewKey) {
        console.error("Upload icon failed: no preview_key in response");
        return "";
      }
      return `${api_host}/api/preview/${previewKey}`;
    } catch (error) {
      console.error("Upload icon error:", error);
      return "";
    }
  }
  return icon;
};

export interface UseRuleEditorOptions {
  rules: Strategy[];
  onSuccess: () => void;
}

// 创建 Pipeline 对象的辅助函数
const createPipelineFromRule = (rule: Partial<Strategy>): Pipeline => {
  // 1. 获取传入的 steps
  const inputSteps = rule.pipeline_profile?.steps || []

  // 2. 使用 DEFAULT_PIPELINE_STEP 作为基准补全缺失字段
  const normalizedSteps = inputSteps.map(inputStep => {
    // 找到对应的默认步骤
    const defaultStep = DEFAULT_PIPELINE_STEP.find(d => d.step_key === inputStep.step_key)

    if (!defaultStep) {
      // 如果没有找到对应的默认步骤，至少填充基本字段
      return {
        step_key: inputStep.step_key,
        run_mode: inputStep.run_mode || 'auto',
        name: inputStep.name || inputStep.step_key,
        description: inputStep.description || '',
        config: inputStep.config || {},
      }
    }

    // 合并：默认值 + 输入值（输入值覆盖默认值）
    return {
      ...defaultStep,
      ...inputStep,
      config: {
        ...defaultStep.config,
        ...(inputStep.config || {}),
      },
    }
  })

  // 3. 如果没有输入步骤，使用默认步骤
  const steps = normalizedSteps.length > 0 ? normalizedSteps : JSON.parse(JSON.stringify(DEFAULT_PIPELINE_STEP))

  return {
    id: rule.pipeline_id || '',
    name: rule.pipeline_name || "",
    icon: rule.icon || "",
    created_at: "",
    profile_json: { steps },
    stats: { total: 0, success_rate: 0 },
  };
};

export function useRuleEditor({ rules, onSuccess }: UseRuleEditorOptions) {
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [editingRule, setEditingRule] = useState<Partial<Strategy>>(() =>
    JSON.parse(JSON.stringify(DEFAULT_RULE))
  );
  const [currentPipeline, setCurrentPipeline] = useState<Pipeline | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const lastInputRef = useRef<any>(null);
  const editorRef = useRef<EditorRef>(null);
  const userInteractedRef = useRef(false);
  const initialRuleRef = useRef<Partial<Strategy>>({});

  // Is editing default rule
  const isEditingDefault = useMemo(
    () => editingRule.is_default === true,
    [editingRule]
  );

  // 包装 setEditingRule，标记用户有过交互
  const updateEditingRule: typeof setEditingRule = useCallback((action) => {
    userInteractedRef.current = true;
    setEditingRule(action);
  }, []);

  // Handle add
  const handleAdd = useCallback(() => {
    const maxPriority = Math.max(
      0,
      ...rules.filter((r) => !r.is_default).map((r) => r.priority)
    );
    const newRule = {
      ...JSON.parse(JSON.stringify(DEFAULT_RULE)),
      priority: maxPriority + 1,
    };
    const newPipeline = createNewPipeline();
    setEditingRule(newRule);
    initialRuleRef.current = JSON.parse(JSON.stringify(newRule));
    setCurrentPipeline(newPipeline);
    setCurrentStep(0);
    userInteractedRef.current = false;
    setDrawerVisible(true);
  }, [rules]);

  // Handle edit
  const handleEdit = useCallback((rule: Strategy) => {
    const ruleCopy = JSON.parse(JSON.stringify(rule));
    const pipeline = createPipelineFromRule(rule);
    setEditingRule(ruleCopy);
    initialRuleRef.current = JSON.parse(JSON.stringify(ruleCopy));
    setCurrentPipeline(pipeline);
    setCurrentStep(0);
    userInteractedRef.current = false;
    setDrawerVisible(true);
  }, []);

  // Handle edit default
  const handleEditDefault = useCallback((defaultRule: Strategy | null) => {
    if (!defaultRule) return;

    const ruleCopy = JSON.parse(JSON.stringify(defaultRule));
    const pipeline = createPipelineFromRule(defaultRule);
    setEditingRule(ruleCopy);
    initialRuleRef.current = JSON.parse(JSON.stringify(ruleCopy));
    setCurrentPipeline(pipeline);
    setCurrentStep(0);
    userInteractedRef.current = false;
    setDrawerVisible(true);
  }, []);

  // Handle delete - 同时删除策略和管线
  const handleDelete = useCallback(async (rule: Strategy) => {
    Modal.confirm({
      content: t("cleaning_policy.delete_confirm", { name: rule.name }),
      okText: t("action.confirm"),
      cancelText: t("action.cancel"),
      onOk: async () => {
        try {
          // 1. 删除策略
          await ragStrategyApi.delete(rule.id);
          // 2. 删除关联的管线
          if (rule.pipeline_id) {
            await ragPipelineApi.delete(rule.pipeline_id);
          }
          message.success(t("action_delete_success"));
          onSuccess();
        } catch (error) {
          console.error("Delete error:", error);
          message.error(t("action_delete_failed"));
        }
      },
    });
  }, [onSuccess]);

  // Handle toggle
  const handleToggle = useCallback(async (rule: Strategy) => {
    await ragStrategyApi.update(rule.id, { enabled: rule.enabled });
    message.success(t("action_save_success"));
    onSuccess();
  }, [onSuccess]);

  // Toggle logic operator
  const toggleLogicOperator = useCallback(() => {
    userInteractedRef.current = true;
    setEditingRule((prev) => ({ ...prev, logic: prev.logic === 1 ? 2 : 1 }));
  }, []);

  // Add condition
  const addCondition = useCallback(() => {
    userInteractedRef.current = true;
    setEditingRule((prev) => {
      const matchers = prev.conditions_json?.matchers || [];
      if (matchers.length >= 5) return prev;

      return {
        ...prev,
        conditions_json: {
          matchers: [...matchers, { type: "extension", operator: "eq", value: "" }],
        },
      };
    });
  }, []);

  // Remove condition
  const removeCondition = useCallback((index: number) => {
    userInteractedRef.current = true;
    setEditingRule((prev) => {
      const matchers = prev.conditions_json?.matchers || [];
      if (matchers.length <= 1) return prev;

      return {
        ...prev,
        conditions_json: {
          matchers: matchers.filter((_, i) => i !== index),
        },
      };
    });
  }, []);

  // Update condition
  const updateCondition = useCallback((index: number, field: string, value: any) => {
    userInteractedRef.current = true;
    setEditingRule((prev) => {
      const matchers = prev.conditions_json?.matchers || [];
      return {
        ...prev,
        conditions_json: {
          matchers: matchers.map((m, i) => (i === index ? { ...m, [field]: value } : m)),
        },
      };
    });
  }, []);

  // Handle next step
  const handleNextStep = useCallback(() => {
    const trimmedName = editingRule.name?.trim();
    if (!trimmedName) {
      message.warning(t("cleaning_policy.rule_name_required"));
      return;
    }

    // Check duplicate names
    const allNames = rules
      .filter((r) => r.id !== editingRule.id)
      .map((r) => r.name.trim());
    if (allNames.includes(trimmedName)) {
      message.warning(t("cleaning_policy.rule_name_duplicate"));
      return;
    }

    // Validate conditions (skip for default rule)
    if (!isEditingDefault) {
      const matchers = editingRule.conditions_json?.matchers || [];
      const validMatchers = matchers.filter((m) => m.value?.trim());
      if (validMatchers.length === 0) {
        message.warning(t("cleaning_policy.condition_required"));
        return;
      }
    }

    setCurrentStep(1);
  }, [editingRule, rules, isEditingDefault]);

  // Handle prev step
  const handlePrevStep = useCallback(() => {
    setCurrentStep(0);
  }, []);

  // Handle save
  const handleSave = useCallback(async (pipeline: Pipeline) => {
    setSubmitting(true);
    try {
      const isCreating = !editingRule.id;

      // 上传图标（如果是 blob URL）
      const uploadedIcon = await uploadIconIfNeeded(pipeline.icon || editingRule.icon || "");

      // 1. 创建或更新管线
      let savedPipeline: { id: string; name: string; icon: string };
      if (isCreating || !pipeline.id) {
        // 创建新管线
        const newPipeline = await ragPipelineApi.create({
          name: editingRule.name?.trim() || t("cleaning_policy.untitled_pipeline"),
          icon: uploadedIcon,
          profile_json: pipeline.profile_json || { steps: [] },
        });
        savedPipeline = {
          id: newPipeline.id,
          name: newPipeline.name,
          icon: newPipeline.icon || uploadedIcon,
        };
      } else {
        // 更新已有管线 - 名称同步为策略名称
        const pipelineName = editingRule.name?.trim() || pipeline.name;
        await ragPipelineApi.update(pipeline.id, {
          name: pipelineName,
          icon: uploadedIcon,
          profile_json: pipeline.profile_json,
        });
        savedPipeline = {
          id: pipeline.id,
          name: pipelineName,
          icon: uploadedIcon,
        };
      }

      // 2. 创建或更新策略
      const strategyData: any = {
        name: editingRule.name?.trim(),
        pipeline_id: savedPipeline.id,
        icon: savedPipeline.icon,
      };

      if (!isEditingDefault) {
        strategyData.conditions_json = editingRule.conditions_json;
        strategyData.logic = editingRule.logic;
      }

      if (isCreating) {
        // 创建策略
        await ragStrategyApi.create({
          icon: strategyData.icon,
          name: strategyData.name,
          priority: editingRule.priority,
          pipeline_id: savedPipeline.id,
          logic: strategyData.logic || 1,
          enabled: true,
          conditions_json: strategyData.conditions_json || { matchers: [] },
        });
      } else {
        // 更新策略
        await ragStrategyApi.update(editingRule.id!, strategyData);
      }

      onSuccess();
      setDrawerVisible(false);
      setCurrentStep(0);
      message.success(t("message_status.save_success"));
    } catch (error) {
      console.error("Save error:", error);
      message.error(t("message_status.save_failed"));
    } finally {
      setSubmitting(false);
    }
  }, [editingRule, isEditingDefault, onSuccess]);

  // Handle pipeline change
  const handlePipelineChange = useCallback((pipeline: Pipeline) => {
    setCurrentPipeline(pipeline);
  }, []);

  // Handle drawer close
  const handleDrawerClose = useCallback(() => {
    // 深对比当前数据与打开时的初始快照，有变化才弹窗确认
    const currentJson = JSON.stringify({
      name: editingRule.name,
      logic: editingRule.logic,
      conditions_json: editingRule.conditions_json,
    });
    const initialJson = JSON.stringify({
      name: initialRuleRef.current.name,
      logic: initialRuleRef.current.logic,
      conditions_json: initialRuleRef.current.conditions_json,
    });

    if (currentJson !== initialJson) {
      Modal.confirm({
        title: t("tip"),
        content: t("cleaning_policy.unsaved_confirm_message"),
        onOk: () => {
          setDrawerVisible(false);
          setCurrentStep(0);
        },
      });
    } else {
      setDrawerVisible(false);
      setCurrentStep(0);
    }
  }, [editingRule]);

  return {
    // State
    drawerVisible,
    currentStep,
    editingRule,
    currentPipeline,
    submitting,
    isEditingDefault,
    editorRef,
    lastInputRef,

    // Actions
    handleAdd,
    handleEdit,
    handleEditDefault,
    handleDelete,
    handleToggle,
    handleDrawerClose,
    handleNextStep,
    handlePrevStep,
    handleSave,
    handlePipelineChange,
    toggleLogicOperator,
    addCondition,
    removeCondition,
    updateCondition,
    setEditingRule: updateEditingRule,
    setCurrentPipeline,
  };
}

export default useRuleEditor;
