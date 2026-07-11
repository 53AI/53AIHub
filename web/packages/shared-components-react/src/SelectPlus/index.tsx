import { Select } from "antd";
import type { SelectProps } from "antd";
import type { ReactNode } from "react";
import { useMemo, useCallback } from "react";

export interface OptionItem {
  value: string | number;
  label: string;
  icon?: string | ReactNode;
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
  /** 翻译函数 */
  t?: (key: string) => string;
  /** Render prop for item after content */
  itemAfter?: (item: OptionItem) => ReactNode;
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
  placeholder,
  value,
  onChange,
  itemAfter,
  t = (key) => key,
  ...restProps
}: SelectPlusProps) {
  const placeholderText = placeholder || t('form.select_placeholder');

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

  // Render icon
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

  // Convert options to antd format
  const selectOptions = useMemo(() => {
    return options.map((item) => {
      if (item.options) {
        return {
          label: getLabel(item.label),
          options: item.options.map((row) => ({
            value: row.value,
            label: getLabel(row.label),
            _icon: row.icon,
            _item: row,
          })),
        };
      }

      return {
        value: item.value,
        label: getLabel(item.label),
        _icon: item.icon,
        _item: item,
      };
    });
  }, [options, useI18n]);

  // Custom label render
  const labelRender = useCallback(
    (option: any) => {
      const item = option._item || selectedOption;
      const icon = option._icon || selectedOption.icon;
      const labelText = option.label || selectedOption.label;
      if (!item.value) {
        return <div className="flex items-center gap-2">
          <span className="text-[#BFBFBF]">{placeholderText}</span>
        </div>;
      }
      return (
        <div className="flex items-center gap-2">
          {icon && renderIcon(icon)}
          <span>{useI18n ? getLabel(labelText) : labelText}</span>
        </div>
      );
    },
    [selectedOption, useI18n, iconType],
  );

  // Custom option render for dropdown
  const optionRender = useCallback(
    (option: any) => {
      const item = option._item;
      const icon = option._icon;

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
      placeholder={placeholderText}
      {...restProps}
    />
  );
}

export default SelectPlus;
