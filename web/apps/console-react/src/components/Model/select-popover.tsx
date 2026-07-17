import { Popover, Slider, Tooltip } from "antd";
import { DownOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { useCallback } from "react";
import ModelSelect from "./select";
import ModelView from "./view";
import type { ModelUseType, ReasoningMode } from "@/constants/platform/config";
import { t } from "@/locales";

interface ModelSelectPopoverProps {
  className?: string;
  value?: string;
  channelId?: number;
  modelName?: string;
  temperature?: number;
  type?: ModelUseType;
  mode?: ReasoningMode;
  customClass?: string;
  onChange?: (value: string) => void;
  onTemperatureChange?: (value: number) => void;
}

export function ModelSelectPopover({
  className,
  value,
  channelId,
  modelName,
  temperature,
  type,
  mode,
  customClass,
  onChange,
  onTemperatureChange,
}: ModelSelectPopoverProps) {
  const handleModelChange = useCallback(
    (newValue: string) => {
      onChange?.(newValue);
    },
    [onChange],
  );

  const handleTemperatureChange = useCallback(
    (newValue: number | number[]) => {
      const temp = Array.isArray(newValue) ? newValue[0] : newValue;
      onTemperatureChange?.(temp);
    },
    [onTemperatureChange],
  );

  const content = (
    <>
      <div className="text-sm text-secondary">{t("model.select_model")}</div>
      <ModelSelect
        className="w-full mt-2"
        value={value}
        type={type}
        mode={mode}
        onChange={handleModelChange}
        valueKey="model_value"
      />
      <div className="flex items-center mt-2">
        <div className="flex-none w-[58px] text-sm text-secondary flex items-center">
          {t("model.temperature")}
          <Tooltip title={t("model.temperature_desc")} placement="top">
            <QuestionCircleOutlined className="ml-1 cursor-pointer" />
          </Tooltip>
        </div>
        <div className="flex-1">
          <Slider
            value={temperature}
            min={0}
            max={1}
            step={0.1}
            onChange={handleTemperatureChange}
          />
        </div>
        <div className="flex-none w-9 text-center text-sm text-dark">
          {temperature}
        </div>
      </div>
    </>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottom"
      classNames={{
        root: "w-[355px]",
      }}
    >
      <div
        className={[
          "h-9 px-3 border rounded flex items-center gap-1 cursor-pointer",
          className || "w-full",
          customClass,
        ].join(" ")}
      >
        <ModelView
          className="flex-1 overflow-hidden"
          channelId={channelId || ""}
          model={modelName || ""}
          placeholder={
            <div className="flex-1 text-sm text-placeholder">
              {t("form_select_placeholder")}
            </div>
          }
        />
        <DownOutlined style={{ color: "#C9C9C9" }} />
      </div>
    </Popover>
  );
}

export default ModelSelectPopover;
