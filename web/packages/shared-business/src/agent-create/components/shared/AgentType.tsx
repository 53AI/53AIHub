import { CheckCircleFilled } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";

interface AgentTypeOption {
  icon?: string;
  label: string;
  description: string;
  value: string;
}

interface AgentTypeSelectorProps {
  value: string;
  options: AgentTypeOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function AgentTypeSelector({
  value,
  options,
  disabled = false,
  onChange,
}: AgentTypeSelectorProps) {
  const handleChange = (newValue: string) => {
    if (disabled) return;
    onChange(newValue);
  };

  return (
    <div className="flex items-center gap-4 mb-4">
      {options.map((item) => (
        <div
          key={item.value}
          className={`flex-1 border rounded px-4 py-3 ${
            item.value === value
              ? "border-[#007AFF] bg-[#2563EB] bg-opacity-5"
              : "border-[#E5E5E5]"
          } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
          onClick={() => handleChange(item.value)}
        >
          <div className="flex items-center gap-2">
            <div className="size-4 flex items-center justify-center">
              {item.icon && <SvgIcon name={item.icon} />}
            </div>
            <p className="flex-1 text-sm text-[#1D1E1F] font-medium">
              {item.label}
            </p>
            {value === item.value && (
              <CheckCircleFilled className="size-4 text-[#2563EB]" />
            )}
          </div>
          <p className="text-xs text-[#9A9A9A] mt-2">{item.description}</p>
        </div>
      ))}
    </div>
  );
}

export default AgentTypeSelector;
