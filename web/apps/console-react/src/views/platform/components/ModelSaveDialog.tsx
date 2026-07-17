import {
  Modal,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Switch,
  Button,
  Checkbox,
  message,
  Spin,
  Tooltip,
} from "antd";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { t } from "@/locales";
import {
  channelApi,
  ModelOption
} from "@/api/modules/channel";
import { MODEL_USE_TYPE, MODEL_VALUES } from "@/constants/platform/config";
import { useEnterpriseStore } from "@/stores";
import { useVersion } from "@/hooks";
import { VERSION_MODULE } from "@/constants/enterprise";
import {
  getFormConfig,
  FormConfig,
  buildModelValue,
  parseModelValue,
  DEFAULT_CONTEXT_LENGTH,
  DEFAULT_MAX_TOKENS,
  MAX_TOKENS_LIMIT,
  CONTEXT_LENGTH_LIMIT,
  DEFAULT_VECTOR_DIMENSION, DEBOUNCE_DELAY
} from "@/constants/platform/model";
import { useDebounceFn } from "@/hooks";
import { SvgIcon } from "@km/shared-components-react";
import { clearModelCache } from "@/components/Model";

interface ModelSaveDialogProps {
  open: boolean;
  modelList?: ModelOption[];
  data?: any;
  onClose: () => void;
  onSuccess: () => void;
}

interface ExtendedModel {
  icon: string;
  model_id: string;
  model_name: string;
  deep_thinking?: boolean;
  dimensions?: number;
  max_tokens?: number;
  context_length?: number;
  vision?: boolean;
  is_system?: boolean;
  value?: string;
  label?: string;
  model_type?: number;
}

interface ExtendedModelCategory {
  icon: string;
  model_type: number;
  model_type_name: string;
  model_count: number;
  models: ExtendedModel[];
}

// 多模型配置项接口
interface ConfigModelItem {
  model_id: string;
  max_tokens?: number;
  context_length?: number;
  deep_thinking?: boolean;
  vision?: boolean;
}

interface FormData {
  channel_id?: number;
  type: number;
  priority: number;
  weight: number;
  key: string;
  name: string;
  other: string;
  base_url: string;
  models: string[];
  model_type: number;
  model_mapping: string;
  custom_config: {
    models: any[];
    alias_map: Record<string, string>;
    [key: string]: any;
  };
  // 多模型时为数组，单模型时为对象
  config: ConfigModelItem[] | Record<string, any>;
}

const DEFAULT_FORM: FormData = {
  type: 0,
  priority: 0,
  weight: 0,
  key: "",
  name: "",
  other: "",
  base_url: "",
  models: [],
  model_type: MODEL_USE_TYPE.REASONING,
  model_mapping: "",
  custom_config: {
    models: [],
    alias_map: {},
  },
  config: {},
};

// Normalize custom_config with validation
const normalizeCustomConfig = (custom_config: any) => {
  const next = {
    models: [] as any[],
    alias_map: {} as Record<string, string>,
    ...(custom_config || {}),
  };
  if (!Array.isArray(next.models)) next.models = [];
  if (
    !next.alias_map ||
    typeof next.alias_map !== "object" ||
    Array.isArray(next.alias_map)
  ) {
    next.alias_map = {};
  }
  // 移除 max_tokens 和 context_length（已迁移到 config 数组）
  delete next.max_tokens;
  delete next.context_length;
  return next;
};

export function ModelSaveDialog({
  open,
  modelList = [],
  data,
  onClose,
  onSuccess,
}: ModelSaveDialogProps) {
  const enterpriseStore = useEnterpriseStore();
  const { canUse: canUseKnowledgeBase } = useVersion({
    module: VERSION_MODULE.KNOWLEDGE_BASE,
  });
  const [form] = Form.useForm();
  const [modelAddForm] = Form.useForm();

  const [loading, setLoading] = useState(false);
  const [modelAddVisible, setModelAddVisible] = useState(false);
  const [modelSchemas, setModelSchemas] = useState<FormConfig[]>([]);
  const [modelOptions, setModelOptions] = useState<ExtendedModelCategory[]>([]);
  const [platformName, setPlatformName] = useState("");
  const [isSingleModel, setIsSingleModel] = useState(false);
  const [formData, setFormData] = useState<FormData>({ ...DEFAULT_FORM });
  const [modelAddData, setModelAddData] = useState({
    model_id: "",
    model_name: "",
    model_type: MODEL_USE_TYPE.REASONING,
    vision: false,
    deep_thinking: false,
    text_generation: false,
    vector_dimension: DEFAULT_VECTOR_DIMENSION,
    max_tokens: DEFAULT_MAX_TOKENS,
    context_length: DEFAULT_CONTEXT_LENGTH,
  });

  // 外部 API 获取的模型配置映射
  const [externalModelConfig, setExternalModelConfig] = useState<{
    maxTokens: Record<string, number>;
    contextLength: Record<string, number>;
  }>({ maxTokens: {}, contextLength: {} });

  // 展开的模型 ID 集合
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());

  // 切换模型展开状态（仅推理模型可展开）
  const toggleExpand = (modelId: string, modelType?: string) => {
    // 非推理模型不允许展开
    if (modelType && String(modelType) !== MODEL_USE_TYPE.REASONING) return;
    setExpandedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  // 组件加载时获取外部 API 数据
  useEffect(() => {
    let isMounted = true;
    channelApi.externalModels().then((data) => {
      if (isMounted && data) setExternalModelConfig(data);
    });
    return () => { isMounted = false; };
  }, []);

  // 防止 useEffect 因 data 引用变化而重复初始化表单
  const initializedChannelId = useRef<number | null | undefined>(undefined);

  // Filter visible schemas
  const visibleSchemas = useMemo(() => {
    const features = enterpriseStore.version?.features;
    let schemas = modelSchemas.filter(
      (config) => !config.showWhen || config.showWhen(formData),
    );

    if (!canUseKnowledgeBase && features) {
      schemas = schemas.map((config) => {
        if (config.prop === "model_type") {
          return {
            ...config,
            options: config.options?.filter(
              (option) => option.value === MODEL_USE_TYPE.REASONING,
            ),
          };
        }
        return config;
      });
    }
    return schemas;
  }, [modelSchemas, formData, canUseKnowledgeBase, enterpriseStore.version?.features]);

  // Has model type field
  const hasModelType = useMemo(() => {
    return modelSchemas.some((item) => item.prop === "model_type");
  }, [modelSchemas]);

  // Single model options
  const singleModelOptions = useMemo(() => {
    if (hasModelType) {
      const option = modelOptions.find(
        (item) => Number(item.model_type) === Number(formData.model_type),
      );
      return option?.models || [];
    }
    return modelOptions.flatMap((item) => item.models);
  }, [hasModelType, modelOptions, formData.model_type]);

  // Multiple model options
  const multipleModelOptions = useMemo(() => {
    const customModels = (formData.custom_config?.models || [])
      .filter((item: any) => !item.is_system)
      .map((item: any) => ({
        ...item,
        value: buildModelValue(item.model_type, item.model_id),
        label: item.model_name,
        icon: item.icon,
      }));

    return modelOptions.map((item) => ({
        ...item,
      models: item.models.concat(
            customModels.filter(
              (model: any) => model.model_type === item.model_type,
            ),
      ),
    }));
  }, [modelOptions, formData.custom_config]);

  // Initialize form - 返回 schemas 供后续使用
  const initForm = (channelData: any = {}): FormConfig[] => {
    const type = channelData.channel_type || 0;
    const schemas = getFormConfig(type);
    setModelSchemas(schemas);

    const newFormData: FormData = { ...DEFAULT_FORM, type };

    schemas.forEach((schema) => {
      if (schema.prop === "model_type") {
        newFormData.model_type = MODEL_USE_TYPE.REASONING;
      } else if (schema.prop === "models") {
        newFormData.models = (channelData.models || "")
          .toString()
          .split(",")
          .filter(Boolean);
        setIsSingleModel(!schema.multiple);
      } else if ("default" in schema) {
        const [parent, child] = schema.prop.split(".");
        if (child && parent === "config") {
          newFormData.config[child] = schema.default;
        } else {
          (newFormData as any)[schema.prop] = schema.default;
        }
      }
    });

    newFormData.custom_config = normalizeCustomConfig(
      channelData.custom_config,
    );

    setFormData(newFormData);
    form.setFieldsValue(newFormData);
    return schemas;
  };

  // Assign form data - 接收 schemas 参数避免依赖异步状态
  const assignForm = (channelData: any = {}, schemas: FormConfig[] = []) => {
    if (!channelData.channel_id) return;

    // 直接从传入的 schemas 计算 isSingleModel
    const modelsSchema = schemas.find((s) => s.prop === "models");
    const isSingleModelNow = modelsSchema ? !modelsSchema.multiple : false;

    const customConfigKeys = Object.keys(
      channelData.custom_config || {},
    ).filter(
      (key) =>
        !["deep_thinking", "vision", "alias_map", "models"].includes(key),
    );
    const models = customConfigKeys.map(
      (item) => buildModelValue(channelData.custom_config[item], item),
    );

    // 从 schemas 中获取 config 字段的默认值，避免依赖异步的 formData.config
    const defaultConfig: Record<string, any> = {};
    schemas.forEach((schema) => {
      if ("default" in schema) {
        const [parent, child] = schema.prop.split(".");
        if (child && parent === "config") {
          defaultConfig[child] = schema.default;
        }
      }
    });

    // 判断 config 是否为数组格式（新格式）
    const isConfigArray = Array.isArray(channelData.config);

    // 合并默认值和后端数据
    let mergedConfig: any;

    if (isSingleModelNow) {
      // 单模型：config 为对象格式
      mergedConfig = { ...defaultConfig, ...channelData.config };
    } else if (isConfigArray) {
      // 多模型新格式：config 为数组
      mergedConfig = channelData.config;
    } else {
      // 多模型旧格式：从 custom_config 数组构建 config 数组
      const deepThinkingList = channelData.custom_config?.deep_thinking || [];
      const visionList = channelData.custom_config?.vision || [];
      const maxTokensMap = channelData.custom_config?.max_tokens || {};
      const contextLengthMap = channelData.custom_config?.context_length || {};

      mergedConfig = models.map((modelValue: string) => {
        const parsed = parseModelValue(modelValue);
        const modelId = parsed?.modelId || modelValue;
        return {
          model_id: modelId,
          max_tokens: maxTokensMap[modelId],
          context_length: contextLengthMap[modelId],
          deep_thinking: deepThinkingList.includes(modelId),
          vision: visionList.includes(modelId),
        };
      });
    }

    // 单选模型时，直接使用第一个模型ID
    const modelValue = isSingleModelNow
      ? Array.isArray(channelData.models)
        ? channelData.models[0] || ""
        : channelData.models || ""
      : models;

    // 检查是否有 model_type 字段
    const hasModelTypeNow = schemas.some((item) => item.prop === "model_type");

    // 规范化 custom_config（会自动移除 max_tokens）
    const mergedCustomConfig = normalizeCustomConfig(channelData.custom_config);

    const newFormData: FormData = {
      channel_id: channelData.channel_id,
      type: channelData.channel_type,
      base_url: channelData.base_url || "",
      key: channelData.key || "",
      name: channelData.name || "",
      other: channelData.other || "",
      models: Array.isArray(modelValue)
        ? modelValue
        : [modelValue].filter(Boolean),
      weight: channelData.weight || 0,
      priority: channelData.priority || 0,
      model_type:
        hasModelTypeNow && isSingleModelNow && customConfigKeys.length > 0
          ? channelData.custom_config[customConfigKeys[0]]
          : MODEL_USE_TYPE.REASONING,
      config: mergedConfig,
      custom_config: mergedCustomConfig,
      model_mapping: channelData.model_mapping || "",
    };

    setFormData(newFormData);
    form.setFieldsValue(newFormData);
  };

  // Load model list
  const loadModelList = useCallback(
    (channelType: number) => {
      if (!Array.isArray(modelList)) return;
      const models = modelList.find(
        (item: any) => item.channel_type === channelType,
      );
      if (!models) return;

      const options = JSON.parse(JSON.stringify(models.categories)).map(
        (item: any) => ({
          ...item,
          models: item.models.map((model: any) => ({
            ...model,
            is_system: true,
            model_type: item.model_type,
            value: buildModelValue(item.model_type, model.model_id),
            label: model.model_name,
          })),
        }),
      );

      setModelOptions(options);
    },
    [modelList],
  );

  // Handle open
  useEffect(() => {
    if (open && data) {
      const channelType = data.channel_type || 0;
      const channelId = data.channel_id ?? null;
      // 防止 data 引用变化导致重复初始化，避免清空用户已修改的字段
      if (initializedChannelId.current === channelId) return;
      initializedChannelId.current = channelId;
      setPlatformName(data.platform_name || "");
      setModelOptions([]); // 先清空旧数据
      setExpandedModels(new Set()); // 清空展开状态
      const schemas = initForm(data);
      const timerId = setTimeout(() => {
        assignForm(data, schemas);
        loadModelList(channelType);
      }, 0);
      return () => clearTimeout(timerId);
    } else if (!open) {
      // 关闭时也清空
      setExpandedModels(new Set());
      initializedChannelId.current = undefined;
    }
  }, [open, data]);

  // Handle model change
  const handleModelChange = (value: string) => {
    const models = [...formData.models];
    const index = models.indexOf(value);
    if (index > -1) {
      models.splice(index, 1);
    } else {
      models.push(value);
    }
    setFormData((prev) => ({ ...prev, models }));
  };

  // Handle model add
  const handleModelAdd = (opt: ExtendedModelCategory) => {
    setModelAddData({
      model_id: "",
      model_name: "",
      model_type: String(opt.model_type) as any,
      vision: false,
      deep_thinking: false,
      text_generation: false,
      vector_dimension: DEFAULT_VECTOR_DIMENSION,
      max_tokens: DEFAULT_MAX_TOKENS,
      context_length: DEFAULT_CONTEXT_LENGTH,
    });
    modelAddForm.setFieldsValue({
      model_id: "",
      model_name: "",
      vision: false,
      deep_thinking: false,
      text_generation: false,
      vector_dimension: DEFAULT_VECTOR_DIMENSION,
      max_tokens: DEFAULT_MAX_TOKENS,
      context_length: DEFAULT_CONTEXT_LENGTH,
    });
    setModelAddVisible(true);
  };

  // Handle model add save
  const handleModelAddSave = async () => {
    try {
      const values = await modelAddForm.validateFields();
      const modelId = values.model_id.trim();

      // 检查是否已存在于自定义模型列表中
      const existsInCustomModels = (formData.custom_config?.models || []).some(
        (item: any) => item.model_id === modelId
      );
      if (existsInCustomModels) {
        message.warning(t("module.platform_model_model_exists"));
        return;
      }

      // 检查是否已存在于系统模型列表中（同类型）
      const category = modelOptions.find(
        (item) => Number(item.model_type) === Number(modelAddData.model_type)
      );
      const existsInSystemModels = category?.models.some(
        (item) => item.model_id === modelId
      );
      if (existsInSystemModels) {
        message.warning(t("module.platform_model_model_exists"));
        return;
      }

      const newModel = {
        model_id: modelId,
        model_name: values.model_name || modelId,
        model_type: Number(modelAddData.model_type),
        vision: modelAddData.vision,
        deep_thinking: modelAddData.deep_thinking,
        text_generation: modelAddData.text_generation,
        vector_dimension: values.vector_dimension
          ? Number(values.vector_dimension)
          : undefined,
        max_tokens: values.max_tokens ? Number(values.max_tokens) : undefined,
        context_length: values.context_length ? Number(values.context_length) : undefined,
        is_system: false,
      };

      setFormData((prev) => ({
        ...prev,
        custom_config: {
          ...prev.custom_config,
          models: [...(prev.custom_config.models || []), newModel],
        },
      }));
      setModelAddVisible(false);
    } catch (error) {
      console.error("Validation error:", error);
    }
  };

  // Handle model delete
  const handleModelDelete = (model: ExtendedModel) => {
    setFormData((prev) => ({
      ...prev,
      models: prev.models.filter((item) => item !== model.value),
      custom_config: {
        ...prev.custom_config,
        models: (prev.custom_config.models || []).filter(
          (item: any) => item.model_id !== model.model_id,
        ),
        alias_map: Object.fromEntries(
          Object.entries(prev.custom_config.alias_map || {}).filter(
            ([key]) => key !== model.model_id,
          ),
        ),
      },
    }));
  };

  // Get model by value
  const getModel = (
    value: string,
    channelType: number,
  ): ExtendedModel | undefined => {
    // From system models
    if (Array.isArray(modelList)) {
      for (const item of modelList) {
        for (const category of item.categories) {
          const model = category.models.find(
            (m) => m.model_id === value && item.channel_type === channelType,
          );
          if (model) return model as ExtendedModel;
        }
      }
    }
    // From custom models
    return formData.custom_config?.models?.find(
      (m: any) => m.model_id === value,
    );
  };

  // Filter models by property
  const filterModelsByProperty = (
    models: string[],
    property: "deep_thinking" | "vision",
    channelType: number,
  ): string[] => {
    return models.reduce((acc, modelId) => {
      const config = getModel(modelId, channelType);
      if (config?.[property]) acc.push(config.model_id);
      return acc;
    }, [] as string[]);
  };

  // Build custom config
  const buildCustomConfig = (data: FormData, models: string[]): {
    custom_config: Record<string, any>;
    configModels?: ConfigModelItem[];
  } => {
    const custom_config: Record<string, any> = {};

    if (isSingleModel) {
      // 单模型处理（Azure, CUSTOM_OPENAI）
      const modelId = Array.isArray(data.models) ? data.models[0] : data.models;
      custom_config[modelId] = data.model_type;
      // 只有 custom_openai 才将 other 作为别名保存
      if (data.type === MODEL_VALUES.CUSTOM_OPENAI && data.other && modelId) {
        custom_config.alias_map = { [modelId]: data.other };
      }
      return { custom_config };
    }

    // 多模型处理：构建 config 数组
    // 优先从 formData.config 数组读取用户设置的值，再从系统模型列表或自定义模型获取默认值
    const configModels: ConfigModelItem[] = models.map((modelId) => {
      const systemModelConfig = getModel(modelId, data.type);

      // 从 formData.config 数组查找用户设置的值
      const userConfig = Array.isArray(data.config)
        ? data.config.find((c) => c.model_id === modelId)
        : null;

      // 从 custom_config.models 查找自定义模型的属性
      const customModel = data.custom_config?.models?.find(
        (m: any) => m.model_id === modelId,
      );

      return {
        model_id: modelId,
        max_tokens: userConfig?.max_tokens,
        context_length: userConfig?.context_length,
        deep_thinking: userConfig?.deep_thinking ?? customModel?.deep_thinking ?? systemModelConfig?.deep_thinking ?? false,
        vision: userConfig?.vision ?? customModel?.vision ?? systemModelConfig?.vision ?? false,
      };
    });

    // 添加 model_type 映射到 custom_config
    models.forEach((modelId) => {
      const config = getModel(modelId, data.type);
      if (config?.model_type !== undefined) {
        custom_config[modelId] = config.model_type;
      }
    });

    // 构建 alias_map
    const aliasMap = models.reduce(
      (acc, modelId) => {
        const config = getModel(modelId, data.type);
        if (config?.model_id) {
          acc[config.model_id] = config.model_name;
        }
        return acc;
      },
      {} as Record<string, string>,
    );

    custom_config.alias_map = {
      ...aliasMap,
      ...(data.custom_config.alias_map || {}),
    };

    // 保留自定义模型列表
    if (data.custom_config?.models && Array.isArray(data.custom_config.models)) {
      custom_config.models = data.custom_config.models;
    }

    return { custom_config, configModels };
  };

  // Process models
  const processModels = (data: FormData) => {
    const models: string[] = [];
    const typeMapping: Record<string, string> = {};

    if (isSingleModel) {
      const modelId = Array.isArray(data.models) ? data.models[0] : data.models;
      if (modelId) {
        models.push(modelId);
        typeMapping[modelId] = String(data.model_type);
      }
    } else {
      data.models.forEach((model: string) => {
        const parsed = parseModelValue(model);
        if (parsed?.modelId) {
          models.push(parsed.modelId);
          typeMapping[parsed.modelId] = parsed.modelType;
        }
      });
    }

    return { models, typeMapping };
  };

  // Validate form data before submit
  const validateFormData = (
    saveData: FormData,
    schemas: FormConfig[],
  ): boolean => {
    const modelsSchema = schemas.find((s) => s.prop === "models");
    if (modelsSchema?.required) {
      const modelId = Array.isArray(saveData.models)
        ? saveData.models[0]
        : saveData.models;
      if (!modelId) {
        message.error(t("form_input_placeholder"));
        return false;
      }
    }
    return true;
  };

  // Build request payload
  const buildPayload = (
    saveData: FormData,
    models: string[],
    customConfig: Record<string, any>,
    configModels?: ConfigModelItem[],
  ) => {
    // 多模型使用 configModels 数组，单模型使用 saveData.config
    const config = isSingleModel ? saveData.config : configModels;

    return {
      channel_id: saveData.channel_id,
      type: saveData.type,
      priority: saveData.priority,
      weight: saveData.weight,
      key: saveData.key,
      name: saveData.name,
      other: saveData.other,
      base_url: saveData.base_url,
      models: models.join(","),
      model_mapping: saveData.model_mapping,
      config: JSON.stringify(config),
      custom_config: JSON.stringify(customConfig),
    };
  };

  // Submit channel data
  const submitChannel = async (
    payload: any,
    channelId?: number,
  ) => {
    if (channelId) {
      await channelApi.update(channelId, payload);
    } else {
      await channelApi.create(payload);
    }
  };

  // Handle save
  const handleSave = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();
      // 保留 formData.models，因为列表视图不通过表单控件更新
      // 多模型时 config 是数组，不需要深度合并
      const saveData = {
        ...formData,
        ...values,
        models: formData.models,
        config: isSingleModel
          ? { ...formData.config, ...values.config }
          : formData.config,
      };

      // 验证模型是否为空
      if (!validateFormData(saveData, modelSchemas)) {
        setLoading(false);
        return;
      }

      const { models, typeMapping } = processModels(saveData);
      const { custom_config, configModels } = buildCustomConfig(saveData, models);

      // Merge type mapping into custom_config
      Object.assign(custom_config, typeMapping);

      const payload = buildPayload(saveData, models, custom_config, configModels);
      await submitChannel(payload, saveData.channel_id);

      message.success(t("action_save_success"));
      clearModelCache();
      onSuccess();
      onClose();
    } catch (error) {
      console.error("Save error:", error);
    } finally {
      setLoading(false);
    }
  };

  // Debounced save handler
  const debouncedSave = useDebounceFn(handleSave, DEBOUNCE_DELAY);

  // Handle field change - 统一处理所有字段变更，同步更新 formData 和 form 内部值
  const handleFieldChange = (prop: string, value: any) => {
    setFormData((prev) => {
      const [parent, child] = prop.split(".");
      if (child && parent === "config") {
        // 单模型时，config 是对象
        if (!Array.isArray(prev.config)) {
          const newConfig = { ...prev.config, [child]: value };
          form.setFieldValue([parent, child], value);
          return {
            ...prev,
            config: newConfig,
          };
        }
      }
      form.setFieldValue(prop, value);
      return { ...prev, [prop]: value };
    });
  };

  // Handle number input change with min/default logic
  const handleNumberChange = (prop: string, value: any, config: FormConfig) => {
    let finalValue = value;

    if (value === null || value === undefined || value === "") {
      finalValue = config.default ?? config.min ?? 1;
    } else if (config.min !== undefined && value < config.min) {
      finalValue = config.default ?? config.min;
    }
    console.log(prop)
    handleFieldChange(prop, finalValue);
  };

  // Handle single model select - set vision and deep_thinking config
  const setModelValue = (prop: string, value: any) => {
    const model = singleModelOptions.find((item) => item.model_id === value);
    const newVision = model?.vision || false;
    const newDeepThinking = model?.deep_thinking || false;
    setFormData((prev) => ({
      ...prev,
      models: [value],
      config: {
        ...prev.config,
        vision: newVision,
        deep_thinking: newDeepThinking,
      },
    }));
    form.setFieldValue("models", value);
    // 同步更新 form 内部值，避免 formData 与 form 内部值不一致
    if (!Array.isArray(formData.config)) {
      form.setFieldValue(["config", "vision"], newVision);
      form.setFieldValue(["config", "deep_thinking"], newDeepThinking);
    }
  };

  // 获取模型的 max_tokens（优先级：config 数组 > 外部 API > 默认值）
  const getModelMaxTokens = (modelId: string): number => {
    // 从 config 数组读取
    if (Array.isArray(formData.config)) {
      const modelConfig = formData.config.find((c) => c.model_id === modelId);
      if (modelConfig?.max_tokens) return modelConfig.max_tokens;
    }
    // 外部 API
    if (externalModelConfig.maxTokens[modelId]) {
      return externalModelConfig.maxTokens[modelId];
    }
    return MAX_TOKENS_LIMIT;
  };

  // 获取模型的 max_tokens 上限（用于输入框 max 属性）
  const getModelMaxTokensLimit = (modelId: string): number => {
    // 外部 API 返回的值作为上限
    if (externalModelConfig.maxTokens[modelId]) {
      return externalModelConfig.maxTokens[modelId];
    }
    return CONTEXT_LENGTH_LIMIT;
  };

  // 获取模型的 context_length（优先级：config 数组 > 外部 API > 默认值）
  const getModelContextLength = (modelId: string): number => {
    // 从 config 数组读取
    if (Array.isArray(formData.config)) {
      const modelConfig = formData.config.find((c) => c.model_id === modelId);
      if (modelConfig?.context_length) return modelConfig.context_length;
    }
    // 外部 API
    if (externalModelConfig.contextLength[modelId]) {
      return externalModelConfig.contextLength[modelId];
    }
    return DEFAULT_CONTEXT_LENGTH;
  };

  // 获取模型的 context_length 上限（用于输入框 max 属性）
  const getModelContextLengthLimit = (modelId: string): number => {
    // 外部 API 返回的值作为上限
    if (externalModelConfig.contextLength[modelId]) {
      return externalModelConfig.contextLength[modelId];
    }
    return DEFAULT_CONTEXT_LENGTH;
  };

  // 更新 formData 中模型的 max_tokens
  const handleModelMaxTokensChange = (modelId: string, value: number | null) => {
    const limit = getModelMaxTokensLimit(modelId);
    const finalValue = value ? Math.min(value, limit) : DEFAULT_MAX_TOKENS;
    setFormData((prev) => {
      // 多模型：更新 config 数组
      if (Array.isArray(prev.config)) {
        const config = [...prev.config];
        const existingIndex = config.findIndex((c) => c.model_id === modelId);

        if (existingIndex > -1) {
          config[existingIndex] = { ...config[existingIndex], max_tokens: finalValue };
        } else {
          config.push({ model_id: modelId, max_tokens: finalValue });
        }

        return { ...prev, config };
      }

      // 单模型不使用 config 数组存储 max_tokens
      return prev;
    });
  };

  // 更新 formData 中模型的 context_length
  const handleModelContextLengthChange = (modelId: string, value: number | null) => {
    const limit = getModelContextLengthLimit(modelId);
    const finalValue = value ? Math.min(value, limit) : DEFAULT_CONTEXT_LENGTH;
    setFormData((prev) => {
      // 多模型：更新 config 数组
      if (Array.isArray(prev.config)) {
        const config = [...prev.config];
        const existingIndex = config.findIndex((c) => c.model_id === modelId);

        if (existingIndex > -1) {
          config[existingIndex] = { ...config[existingIndex], context_length: finalValue };
        } else {
          config.push({ model_id: modelId, context_length: finalValue });
        }

        return { ...prev, config };
      }

      // 单模型不使用 config 数组存储 context_length
      return prev;
    });
  };

  // Handle input blur - trim whitespace
  const handleInputBlur = (prop: string, value: string) => {
    const trimmedValue = value.trim();
    handleFieldChange(prop, trimmedValue);

    // 当模型名称（models 字段）变化时，同步从外部 API 更新最大 token 上限
    if (prop === "models" && trimmedValue) {
      const externalMaxTokens = externalModelConfig.maxTokens[trimmedValue];
      const externalContextLength = externalModelConfig.contextLength[trimmedValue];

      handleFieldChange("config.max_tokens", externalMaxTokens || DEFAULT_MAX_TOKENS);
      handleFieldChange("config.context_length", externalContextLength || DEFAULT_CONTEXT_LENGTH);
    }
  };

  // Handle vector dimension change
  const handleVectorDimensionChange = (value: number | null) => {
    if (value !== null && value < 1) {
      modelAddForm.setFieldValue("vector_dimension", 1);
    }
  };

  // Handle max tokens change
  const handleMaxTokensChange = (value: number | null) => {
    const limit = getModelMaxTokensLimit(modelAddData.model_id);
    if (value !== null && value < 1) {
      modelAddForm.setFieldValue("max_tokens", 1);
    } else if (value !== null && value > limit) {
      modelAddForm.setFieldValue("max_tokens", limit);
    }
  };

  // Handle context length change
  const handleContextLengthChange = (value: number | null) => {
    const limit = getModelContextLengthLimit(modelAddData.model_id);
    if (value !== null && value < 1) {
      modelAddForm.setFieldValue("context_length", 1);
    } else if (value !== null && value > limit) {
      modelAddForm.setFieldValue("context_length", limit);
    }
  };

  // Render input field
  const renderInput = (config: FormConfig) => (
    <Input
      placeholder={config.placeholder || ""}
      onBlur={(e) => handleInputBlur(config.prop, e.target.value)}
    />
  );

  // Render input number field
  const renderInputNumber = (config: FormConfig) => (
    <InputNumber
      className="w-full"
      placeholder={config.placeholder || ""}
      min={config.min}
      controls={false}
      onChange={(value) => handleNumberChange(config.prop, value, config)}
    />
  );

  // Render radio group
  const renderRadioGroup = (config: FormConfig) => (
    <Radio.Group
      onChange={(e) => handleFieldChange(config.prop, e.target.value)}
    >
      {config.options?.map((opt) => (
        <Radio key={opt.value} value={opt.value}>
          {opt.label}
        </Radio>
      ))}
    </Radio.Group>
  );

  // Render single model select
  const renderSingleModelSelect = (config: FormConfig) => {
    const currentModelId = formData.models?.[0] || undefined;
    const isCustomModel =
      currentModelId &&
      !singleModelOptions.some((opt) => opt.model_id === currentModelId);

    return (
      <Select
        className="w-full"
        placeholder={config.placeholder || ""}
        showSearch={config.allowCreate}
        allowClear={config.allowCreate}
        filterOption={(input, option) => {
          const label = String(option?.children || option?.value || "");
          return label.toLowerCase().includes(input.toLowerCase());
        }}
        onSearch={
          config.allowCreate
            ? (searchValue) => {
                if (searchValue) {
                  setFormData((prev) => ({
                    ...prev,
                    models: [searchValue],
                  }));
                  form.setFieldValue("models", searchValue);
                }
              }
            : undefined
        }
        onChange={(value) => {
          if (value !== undefined) {
            setModelValue(config.prop, value);
          }
        }}
        value={currentModelId}
      >
        {isCustomModel && (
          <Select.Option value={currentModelId}>
            {currentModelId}
          </Select.Option>
        )}
        {singleModelOptions.map((opt) => (
          <Select.Option key={opt.model_id} value={opt.model_id}>
            {opt.model_name}
          </Select.Option>
        ))}
      </Select>
    );
  };

  // Render model list (multiple select)
  const renderModelList = () => (
    <Spin spinning={loading}>
      <div className="w-full pr-1">
        {!multipleModelOptions.length && (
          <div className="text-gray-400 w-full text-center py-4">
            {t("module.platform_model_models_empty")}
          </div>
        )}
        {multipleModelOptions.map((opt) => (
          <div key={opt.model_type} className="mb-4 flex flex-col gap-2">
            <div className="flex items-center justify-between h-9">
              <span className="text-sm text-gray-500">
                {opt.model_type_name}
              </span>
              <Button
                type="link"
                className="px-0"
                onClick={() => handleModelAdd(opt)}
              >
                + {t("action_add")}
              </Button>
            </div>
            {opt.models.map((item) => (
              <div key={item.value} className="flex flex-col">
                <div className="h-8 flex items-center gap-1.5">
                  {/* 只有推理模型才显示展开/折叠图标 */}
                  {String(item.model_type) === MODEL_USE_TYPE.REASONING && (
                    <SvgIcon
                      name={expandedModels.has(item.model_id) ? "down" : "right"}
                      width={14}
                      className="cursor-pointer text-gray-400 hover:text-gray-600 flex-none"
                      onClick={() => toggleExpand(item.model_id, String(item.model_type))}
                    />
                  )}
                  {item.icon && (
                    <img
                      src={item.icon}
                      className="w-5 h-5 object-contain flex-none"
                      alt=""
                    />
                  )}
                  <div className="flex-1 flex items-center gap-1 overflow-hidden cursor-pointer" onClick={() => toggleExpand(item.model_id, String(item.model_type))}>
                    <span className="text-sm truncate">{item.model_name}</span>
                    {item.model_name !== item.model_id && (
                      <>
                        <span className="text-xs text-gray-400">|</span>
                        <span className="text-xs text-gray-400 truncate">
                          {item.model_id}
                        </span>
                      </>
                    )}
                    {item.deep_thinking && (
                      <Tooltip title={t("model.deep_thinking")}>
                        <div className="w-5 h-5 rounded flex items-center justify-center bg-blue-50 text-blue-500 cursor-pointer">
                          <SvgIcon name="smart-optimization" width={12} />
                        </div>
                      </Tooltip>
                    )}
                    {item.vision && (
                      <Tooltip title={t("platform_model.vision")}>
                        <div className="w-5 h-5 rounded flex items-center justify-center bg-yellow-50 text-yellow-500 cursor-pointer">
                          <SvgIcon name="preview-open" width={12} />
                        </div>
                      </Tooltip>
                    )}
                  </div>
                  {!item.is_system && (
                    <SvgIcon
                      name="delete"
                      width={14}
                      className="cursor-pointer mr-1 text-gray-400 hover:text-red-500"
                      onClick={() => handleModelDelete(item)}
                    />
                  )}
                  <Switch
                    size="small"
                    checked={formData.models.includes(item.value || "")}
                    onChange={() => handleModelChange(item.value || "")}
                  />
                </div>
                {expandedModels.has(item.model_id) && (
                  <div className="px-4 bg-[#F7F8FA] rounded-xl ml-6 mt-2 py-3 flex flex-col gap-3">
                    {/* <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-20 flex-none">
                        {t("module.platform_model_max_tokens")}
                      </span>
                      <InputNumber
                        className="flex-1"
                        min={1}
                        max={getModelMaxTokensLimit(item.model_id)}
                        controls={false}
                        value={getModelMaxTokens(item.model_id)}
                        onChange={(value) =>
                          handleModelMaxTokensChange(item.model_id, value)
                        }
                      />
                    </div> */}
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-22 flex-none">
                        {t("module.platform_model_context_length")}
                      </span>
                      <InputNumber
                        className="flex-1"
                        min={1}
                        max={getModelContextLengthLimit(item.model_id)}
                        controls={false}
                        value={getModelContextLength(item.model_id)}
                        onChange={(value) =>
                          handleModelContextLengthChange(item.model_id, value)
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Spin>
  );

  // Render select field
  const renderSelect = (config: FormConfig) => (
    <Select
      placeholder={config.placeholder || ""}
      allowClear={config.allowCreate}
      showSearch={config.allowCreate}
      onChange={(value) => handleFieldChange(config.prop, value)}
    >
      {config.options?.map((opt) => (
        <Select.Option key={opt.value} value={opt.value}>
          {opt.label}
        </Select.Option>
      ))}
    </Select>
  );

  // Render form item by type
  const renderFormItem = (config: FormConfig) => {
    switch (config.type) {
      case "input":
        return renderInput(config);
      case "input_number":
        return renderInputNumber(config);
      case "radio":
        return renderRadioGroup(config);
      case "url":
        return renderInput(config);
      case "select":
        if (config.prop === "models") {
          return config.multiple
            ? renderModelList()
            : renderSingleModelSelect(config);
        }
        return renderSelect(config);
      default:
        return <Input placeholder={config.placeholder || ""} />;
    }
  };

  return (
    <>
      <Modal
        open={open}
        title={t("action_setting") + platformName}
        onCancel={onClose}
        width={600}
        centered
        destroyOnHidden
        getContainer={false}
        mask={{ closable: false }}
        styles={{
          body: {
            maxHeight: "60vh",
            overflowY: "auto",
          },
        }}
        footer={[
          <Button key="cancel" onClick={onClose}>
            {t("action_cancel")}
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={loading}
            onClick={debouncedSave}
          >
            {t("action_save")}
          </Button>,
        ]}
      >
        <Form form={form} layout="vertical">
          {visibleSchemas.map((config) => {
            // models 列表视图不通过表单控件，需要特殊处理
            const isModelsList = config.prop === "models" && config.multiple;
            // 处理嵌套字段名（如 config.vision）
            const [parent, child] = config.prop.split(".");
            const fieldName = child ? [parent, child] : config.prop;
            return (
              <div key={config.prop}>
                <Form.Item
                  label={config.label}
                  name={isModelsList ? undefined : fieldName}
                  rules={
                    isModelsList
                      ? []
                      : config.required
                        ? [
                            {
                              required: true,
                              message: t("form_input_placeholder"),
                            },
                          ]
                        : []
                  }
                >
                  {renderFormItem(config)}
                </Form.Item>
                {/* 单选模型选中后显示 max_tokens 输入框 */}
                {config.prop === "models" && !config.multiple && formData.models[0] && (
                  // 只有表单配置中没有 max_tokens 字段时才显示
                  !modelSchemas.some(s => s.prop === "config.max_tokens") && (
                    <Form.Item label={t("module.platform_model_max_tokens")}>
                      <InputNumber
                        className="w-full"
                        min={1}
                        max={getModelMaxTokensLimit(formData.models[0])}
                        controls={false}
                        value={getModelMaxTokens(formData.models[0])}
                        onChange={(value) => handleModelMaxTokensChange(formData.models[0], value)}
                      />
                    </Form.Item>
                  )
                )}
              </div>
            );
          })}
        </Form>
      </Modal>

      {/* Model Add Dialog */}
      <Modal
        open={modelAddVisible}
        title={t("action_add")}
        onCancel={() => setModelAddVisible(false)}
        width={600}
        centered
        destroyOnHidden
        getContainer={false}
        mask={{ closable: false }}
        footer={[
          <Button key="cancel" onClick={() => setModelAddVisible(false)}>
            {t("action_cancel")}
          </Button>,
          <Button key="save" type="primary" onClick={handleModelAddSave}>
            {t("action_save")}
          </Button>,
        ]}
      >
        <Form form={modelAddForm} layout="vertical">
          <Form.Item
            label={t("module.platform_model_models_id")}
            name="model_id"
            rules={[{ required: true, message: t("form_input_placeholder") }]}
          >
            <Input
              placeholder={t("form_input_placeholder")}
              onBlur={(e) => {
                const modelId = e.target.value.trim();
                // 更新 modelAddData 状态，用于 InputNumber 的 max 属性
                setModelAddData((prev) => ({
                  ...prev,
                  model_id: modelId,
                }));
                if (modelId) {
                  // 从外部 API 获取 max_tokens
                  modelAddForm.setFieldValue("max_tokens", externalModelConfig.maxTokens[modelId] || DEFAULT_MAX_TOKENS);
                  // 从外部 API 获取 context_length
                  modelAddForm.setFieldValue("context_length", externalModelConfig.contextLength[modelId] || DEFAULT_CONTEXT_LENGTH);
                }
              }}
            />
          </Form.Item>
          <Form.Item
            label={t("module.platform_model_models_name")}
            name="model_name"
          >
            <Input placeholder={t("form_input_placeholder")} />
          </Form.Item>
          {modelAddData.model_type === MODEL_USE_TYPE.REASONING && (
            <>
              <Form.Item
                label={t("module.platform_model_context_length")}
                name="context_length"
              >
                <InputNumber
                  className="w-full"
                  min={1}
                  max={getModelContextLengthLimit(modelAddData.model_id)}
                  controls={false}
                  onChange={handleContextLengthChange}
                />
              </Form.Item>
              <Form.Item
                label={t("module.platform_model_max_tokens")}
                name="max_tokens"
              >
                <InputNumber
                  className="w-full"
                  min={1}
                  max={getModelMaxTokensLimit(modelAddData.model_id)}
                  controls={false}
                  onChange={handleMaxTokensChange}
                />
              </Form.Item>
              <Form.Item label={t("module.platform_model_models_type")}>
                <Checkbox
                  checked={modelAddData.text_generation}
                  onChange={(e) =>
                    setModelAddData((prev) => ({
                      ...prev,
                      text_generation: e.target.checked,
                    }))
                  }
                >
                  {t("platform_model.text_generation")}
                </Checkbox>
                <Checkbox
                  checked={modelAddData.deep_thinking}
                  onChange={(e) =>
                    setModelAddData((prev) => ({
                      ...prev,
                      deep_thinking: e.target.checked,
                    }))
                  }
                >
                  {t("model.deep_thinking")}
                </Checkbox>
                <Checkbox
                  checked={modelAddData.vision}
                  onChange={(e) =>
                    setModelAddData((prev) => ({
                      ...prev,
                      vision: e.target.checked,
                    }))
                  }
                >
                  {t("platform_model.vision")}
                </Checkbox>
              </Form.Item>
            </>
          )}
          {modelAddData.model_type === MODEL_USE_TYPE.EMBEDDING && (
            <>
            <Form.Item
              label={t("module.platform_model_vector_dimension")}
              name="vector_dimension"
            >
              <InputNumber
                className="w-full"
                min={1}
                controls={false}
                onChange={handleVectorDimensionChange}
              />
            </Form.Item>
              <Form.Item
                label={t("module.platform_model_context_length")}
                name="context_length"
              >
                <InputNumber
                  className="w-full"
                  min={1}
                  controls={false}
                  max={getModelContextLengthLimit(modelAddData.model_id)}
                  onChange={handleContextLengthChange}
                />
              </Form.Item>
              <Form.Item
                label={t("module.platform_model_max_tokens")}
                name="max_tokens"
              >
                <InputNumber
                  className="w-full"
                  min={1}
                  controls={false}
                  max={getModelMaxTokensLimit(modelAddData.model_id)}
                  onChange={handleMaxTokensChange}
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </>
  );
}

export default ModelSaveDialog;
