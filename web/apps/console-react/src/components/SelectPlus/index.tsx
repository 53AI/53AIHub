import { Select } from "antd";
import type { SelectProps } from "antd";
import { useMemo, useCallback } from "react";
import { t } from "@/locales";
import "./index.css";

export interface OptionItem {
  value: string | number;
  label: string;
  icon?: string | React.ReactNode;
}

export interface GroupOptionItem extends OptionItem {
  options?: OptionItem[];
}

export interface SelectPlusProps extends Omit<
  SelectProps,
  "options" | "onChange"
> {
  className?: string;
  iconType?: "image" | "svg" | "icon";
  options?: GroupOptionItem[];
  useI18n?: boolean;
  /** Render prop for item after content, similar to Vue's item_after slot */
  itemAfter?: (item: OptionItem) => React.ReactNode;
  /** Change callback with full option info */
  onChange?: (
    value: string | number,
    option: GroupOptionItem | OptionItem,
  ) => void;
}

export function SelectPlus({
  className = "",
  iconType = "image",
  options = [],
  useI18n = true,
  placeholder = t('form.select_placeholder'),
  value,
  onChange,
  itemAfter,
  ...restProps
}: SelectPlusProps) {
  // Get label with i18n
  const getLabel = (label: string) => {
    if (!useI18n) return label;
    return t(label);
  };

  // Find selected option - used for prefix display
  const selectedOption = useMemo(() => {
    let option: GroupOptionItem | OptionItem = { value: "", label: "" };
    options.forEach((item) => {
      if (item.options) {
        item.options.forEach((row) => {
          if (row.value === value) option = row;
        });
      } else if (item.value === value) {
        option = item;
      }
    });
    return option;
  }, [options, value]);

  // Render icon - matches Vue template logic
  const renderIcon = (
    icon?: string | React.ReactNode,
    containerClass = "w-5 h-5",
  ) => {
    if (!icon) return null;

    if (iconType === "image" && typeof icon === "string") {
      return (
        <div className={`${containerClass} inline-block`}>
          <img
            src={icon}
            className="h-full block object-cover rounded"
            alt=""
          />
        </div>
      );
    }

    if (iconType === "icon") {
      return (
        <div
          className={`${containerClass} inline-flex items-center justify-center text-lg`}
        >
          {icon}
        </div>
      );
    }

    // svg or other
    return icon;
  };

  // Find option by value for change callback
  const findOptionByValue = useCallback(
    (val: string | number): GroupOptionItem | OptionItem => {
      let found: GroupOptionItem | OptionItem = { value: "", label: "" };
      options.forEach((item) => {
        if (item.options) {
          item.options.forEach((row) => {
            if (row.value === val) found = row;
          });
        } else if (item.value === val) {
          found = item;
        }
      });
      return found;
    },
    [options],
  );

  // Convert options to antd format - use string labels for filtering
  const selectOptions = useMemo(() => {
    return options.map((item) => {
      if (item.options) {
        return {
          label: getLabel(item.label),
          options: item.options.map((row) => ({
            value: row.value,
            label: getLabel(row.label), // string for filtering
            // Store icon for labelRender
            _icon: row.icon,
            _item: row,
          })),
        };
      }

      return {
        value: item.value,
        label: getLabel(item.label), // string for filtering
        _icon: item.icon,
        _item: item,
      };
    });
  }, [options, useI18n]);

  // Custom label render - display icon + label like Vue prefix
  const labelRender = useCallback(
    (props: any) => {
      const option = findOptionByValue(props.value);  
      const icon = option.icon;
      const labelText = option.label;

      if (!option.value) {
        return (
          <div className="flex items-center gap-2">
            <span className="text-[#BFBFBF]">{placeholder}</span>
          </div>
        );
      }

      return (
        <div className="flex items-center gap-2">
          {icon && renderIcon(icon)}
          <span>{useI18n ? getLabel(labelText) : labelText}</span>
        </div>
      );
    },
    [selectedOption, useI18n, iconType, placeholder, findOptionByValue],
  );

  // Custom option render for dropdown
  const optionRender = useCallback(
    (option: any) => {
      const item = option.data?._item;
      const icon = option.data?._icon; 

      // Guard against undefined item (e.g., group headers)
      if (!item) {
        return <span>{option.label}</span>;
      }

      return (
        <div className="flex items-center gap-2">
          <div className="flex-none w-5 h-5 flex items-center justify-center">
            {renderIcon(icon)}
          </div>
          <span className="flex-1 truncate">{option.label}</span>
          {itemAfter?.(item)}
        </div>
      );
    },
    [itemAfter, iconType],
  );

  // Handle change with full option info
  const handleChange = (val: string | number) => {
    const option = findOptionByValue(val);
    onChange?.(val, option);
  };

  return (
    <Select
      className={className}
      value={value}
      onChange={handleChange}
      options={selectOptions}
      showSearch
      optionFilterProp="label"
      labelRender={labelRender}
      optionRender={optionRender as any}
      {...restProps}
    />
  );
}

export default SelectPlus;
