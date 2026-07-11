import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Select, Spin, Tooltip } from "antd";
import { LoadingOutlined, EyeOutlined } from "@ant-design/icons";
import { loadModels } from "./index";
import {
  MODEL_USE_TYPE,
  type ModelUseType,
  type ReasoningMode,
} from "@/constants/platform/config";
import { t } from "@/locales";

export interface ModelOption {
  value: string;
  model_value: string;
  label: string;
  icon?: string;
  vision?: boolean;
}

export interface ChannelOption {
  value: string;
  label: string;
  icon?: string;
  options: ModelOption[];
}

export interface ModelSelectProps {
  className?: string;
  value?: string;
  onChange?: (value: string, option?: ModelOption) => void;
  valueKey?: "value" | "model_value";
  type?: ModelUseType;
  mode?: ReasoningMode;
  clearable?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

export function ModelSelect({
  className = "",
  value = "",
  onChange,
  valueKey = "value",
  type,
  mode,
  clearable,
  placeholder,
  disabled,
}: ModelSelectProps) {
  const [options, setOptions] = useState<ChannelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const typeRef = useRef(type);
  const modeRef = useRef(mode);
  const valueKeyRef = useRef(valueKey);

  useEffect(() => {
    typeRef.current = type;
    modeRef.current = mode;
    valueKeyRef.current = valueKey;
  }, [type, mode, valueKey]);

  const loadChannelOptions = useCallback(async () => {
    if (loaded) return;
    setLoading(true);
    try {
      const modelList = await loadModels(
        typeRef.current || MODEL_USE_TYPE.REASONING,
        modeRef.current,
      );
      const formattedOptions = modelList.map((item: any) => ({
        ...item,
        label: item.platform_name || item.label,
        options: item.options?.map((option: any) => ({
          ...option,
          value: option[valueKeyRef.current],
        })),
      }));
      setOptions(formattedOptions);
      setLoaded(true);
    } catch (error) {
      console.error("Failed to load models:", error);
    } finally {
      setLoading(false);
    }
  }, [loaded]);

  useEffect(() => {
    loadChannelOptions();
  }, [loadChannelOptions]);

  // 扁平化模型列表
  const flatModelOptions = useMemo(() => {
    return options.flatMap((channel) => channel.options || []);
  }, [options]);

  // 转换为 antd Select 格式
  const selectOptions = useMemo(() => {
    return options.map((channel) => ({
      label: (
        <div className="flex items-center gap-2">
          {channel.icon && (
            <img
              src={channel.icon}
              alt={channel.label}
              className="w-4 h-4 object-contain"
            />
          )}
          <span>{channel.label}</span>
        </div>
      ),
      options: channel.options?.map((model) => ({
        value: model.value,
        label: (
          <div className="flex items-center gap-2">
            {model.icon && (
              <img
                src={model.icon}
                alt={model.label}
                className="w-4 h-4 object-contain"
              />
            )}
            <span>{model.label}</span>
            {model.vision && (
              <Tooltip title={t("support_image")} placement="top">
                <div className="inline-flex items-center justify-center ml-1 w-4 h-4 bg-[#FDF8EB] rounded-sm">
                  <EyeOutlined style={{ fontSize: 10, color: "#F0A105" }} />
                </div>
              </Tooltip>
            )}
          </div>
        ),
        data: model,
      })),
    }));
  }, [options]);

  const handleChange = (selectedValue: string) => {
    const selectedOption = flatModelOptions.find((m) => m.value === selectedValue);
    onChange?.(selectedValue, selectedOption);
  };

  // 自定义搜索逻辑：搜索 label 字符串
  const filterOption = (input: string, option: any) => {
    const modelLabel = option?.data?.label || "";
    return modelLabel.toLowerCase().includes(input.toLowerCase());
  };

  return (
    <Select
      className={className}
      value={value}
      onChange={handleChange}
      options={selectOptions}
      placeholder={placeholder}
      disabled={disabled}
      allowClear={clearable}
      showSearch
      filterOption={filterOption}
      loading={loading}
      style={{ width: "100%" }}
      listHeight={360}
      suffixIcon={
        loading ? (
          <Spin indicator={<LoadingOutlined spin />} size="small" />
        ) : undefined
      }
      notFoundContent={loading ? <Spin size="small" /> : "No data"}
    />
  );
}

export default ModelSelect;
