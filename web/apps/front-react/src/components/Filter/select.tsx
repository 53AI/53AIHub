import React from "react";
import { Button } from "antd";
import { Dropdown } from "@km/shared-components-react";
import { DownOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";

export interface SelectFilterOption {
  [key: string]: string | number | null;
  value: string | number | null;
  label: string;
}

export interface SelectFilterProps {
  value?: string | number | null;
  onChange?: (value: string | number | null) => void;
  options: SelectFilterOption[];
  prop?: {
    value: string;
    label: string;
  };
  showAll?: boolean;
  allOption?: {
    value: null;
    label: string;
  };
  className?: string;
  style?: React.CSSProperties;
}

export const SelectFilter: React.FC<SelectFilterProps> = (props) => {
  const {
    value,
    onChange,
    options = [],
    prop = { value: "value", label: "label" },
    showAll = false,
    allOption = { value: null, label: "全部" },
    className,
    style,
  } = props;

  // Merge options with "all" option
  const mergedOptions: SelectFilterOption[] = React.useMemo(() => {
    if (!showAll) return options;

    return [
      {
        [prop.value]: allOption.value,
        [prop.label]: allOption.label,
      } as SelectFilterOption,
      ...options,
    ];
  }, [options, showAll, allOption, prop]);

  // Get current label
  const label = React.useMemo(() => {
    const found = mergedOptions.find((opt) => opt[prop.value] === value);
    return found?.[prop.label] || "";
  }, [mergedOptions, value, prop]);

  // Handle menu click
  const handleMenuClick: MenuProps["onClick"] = (e) => {
    const clickedValue = e.key;
    // Convert to appropriate type
    const parsedValue =
      clickedValue === "null"
        ? null
        : isNaN(Number(clickedValue))
          ? clickedValue
          : Number(clickedValue);
    onChange?.(parsedValue);
  };

  // Generate menu items
  const menuItems: MenuProps["items"] = mergedOptions.map((opt) => ({
    key: String(opt[prop.value]),
    label: opt[prop.label],
  }));

  return (
    <Dropdown
      menu={{ items: menuItems, onClick: handleMenuClick }}
      trigger={["click"]}
      styles={{ root: { maxHeight: 250, overflow: "auto" } }}
    >
      <Button
        className={`!border-none !outline-none h-9 flex items-center justify-center px-5 gap-1.5 rounded-2xl bg-[#F6F7F8] text-xs text-[#1D1E1F] cursor-pointer ${className || ""}`}
        style={style}
      >
        {label}
        <DownOutlined style={{ fontSize: 14, color: "#9EA5B6" }} />
      </Button>
    </Dropdown>
  );
};

export default SelectFilter;
