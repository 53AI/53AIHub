import type { ReactNode } from "react";
import { useMemo } from "react";
import { Select, Spin, Tooltip } from "antd";
import { LoadingOutlined, EyeOutlined } from "@ant-design/icons";

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
  clearable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  /** 选项数据 */
  options?: ChannelOption[];
  /** 翻译函数 */
  t?: (key: string) => string;
}

export function ModelSelect({
  className = "",
  value = "",
  onChange,
  valueKey = "value",
  clearable,
  placeholder,
  disabled,
  loading = false,
  options = [],
  t = (key) => key,
}: ModelSelectProps) {
  // 根据 valueKey 处理后的扁平化模型列表
  const flatModelOptions = useMemo(() => {
    return options.flatMap((channel) =>
      (channel.options || []).map((model) => ({
        ...model,
        value: model[valueKey], // 按 valueKey 重设 value
      }))
    );
  }, [options, valueKey]);

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
        value: model[valueKey],
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
  }, [options, valueKey, t]);

  const handleChange = (selectedValue: string) => {
    const selectedOption = flatModelOptions.find((m) => m.value === selectedValue);
    // 返回原始 model 数据（包含 value 和 model_value）
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
