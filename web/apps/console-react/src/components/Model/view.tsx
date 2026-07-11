import { useEffect, useState } from "react";
import { LoadingOutlined, QuestionCircleFilled } from "@ant-design/icons";
import { loadModels } from "./index";

export interface ModelInfo {
  icon: string;
  label: string;
  value: string;
  provider_name: string;
}

export interface ModelViewProps {
  className?: string;
  channelId: string | number;
  model: string;
  showIcon?: boolean;
  deleteText?: string;
  size?: string | number;
  type?: "all" | "icon" | "provider_name" | "model";
  placeholder?: React.ReactNode;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
}

export function ModelView({
  className = "",
  channelId = "",
  model = "",
  showIcon = true,
  deleteText = "已删除",
  size = 20,
  type = "all",
  placeholder,
  prefix,
  suffix,
}: ModelViewProps) {
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Compute model value
  const modelValue = channelId && model ? `${channelId}_53aikm_${model}` : "";

  // Load model info
  useEffect(() => {
    const loadModelInfo = async () => {
      if (!channelId || !model) {
        setModelInfo(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const modelList = await loadModels();
        // Find matching model in all channels
        for (const channel of modelList) {
          const matchedOption = channel.options?.find(
            (option: any) => option.value === modelValue,
          );

          if (matchedOption) {
            setModelInfo({
              icon: matchedOption.icon,
              label: matchedOption.label,
              value: matchedOption.value,
              provider_name: matchedOption.provider_name || channel.label,
            });
            return;
          }
        }

        // If no exact match, try matching model name only
        for (const channel of modelList) {
          const matchedOption = channel.options?.find((option: any) => {
            const parts = option.value.split("_53aikm_");
            const modelName = parts[1];
            return modelName === model;
          });

          if (matchedOption) {
            setModelInfo({
              icon: matchedOption.icon,
              label: matchedOption.label,
              value: matchedOption.value,
              provider_name: matchedOption.provider_name || channel.label,
            });
            return;
          }
        }

        setModelInfo(null);
      } catch (error) {
        console.error("Failed to load model info:", error);
        setModelInfo(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadModelInfo();
  }, [channelId, model, modelValue]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 flex items-center justify-center animate-spin">
          <LoadingOutlined style={{ fontSize: 12, color: "#999" }} />
        </div>
      </div>
    );
  }

  if (modelInfo) {
    return (
      <div className={`inline-flex items-center gap-2 ${className}`}>
        {prefix}
        {modelInfo.icon && (type === "all" || type === "icon") && (
          <img
            src={modelInfo.icon}
            alt={modelInfo.label}
            className="object-contain"
            style={{ width: `${size}px`, height: `${size}px` }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        {(type === "all" || type === "provider_name") && (
          <span className="text-sm text-primary whitespace-nowrap">
            {modelInfo.provider_name}
          </span>
        )}
        {(type === "all" || type === "model") && (
          <span className="text-sm text-secondary whitespace-nowrap">
            {modelInfo.label}
          </span>
        )}
        {suffix}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {showIcon && (
        <div className="w-5 h-5 bg-gray-200 rounded flex items-center justify-center">
          <QuestionCircleFilled style={{ fontSize: 12, color: "#999" }} />
        </div>
      )}
      {placeholder || (
        <span className="text-sm text-gray-500 whitespace-nowrap">
          {deleteText}
        </span>
      )}
    </div>
  );
}

export default ModelView;
