import { Select, Skeleton } from "antd";
import { useEffect, useMemo, useRef, useState, forwardRef, useCallback, useImperativeHandle } from "react";
import { t } from "@/locales";
import groupApi from "@/api/modules/group";
import { GROUP_TYPE, type GroupType } from "@/constants/group";

export interface GroupSelectProps {
  value?: number | string | number[] | string[] | null;
  onChange?: (value: number | string | number[] | string[] | null) => void;
  groupType?: GroupType;
  defaultAll?: boolean;
  defaultFirst?: boolean;
  disabled?: boolean;
  size?: "large" | "middle" | "small";
  style?: React.CSSProperties;
  className?: string;
  placeholder?: string;
  // Backward compatibility props
  mode?: "multiple" | "tags";
  multiple?: boolean;
  onOptionsLoad?: (options: GroupOption[]) => void;
}

export interface GroupOption {
  group_id: number;
  group_name: string;
  label: string;
  value: number;
}

export interface GroupSelectRef {
  refresh: () => Promise<void>;
}

function GroupSelectInner(
  props: GroupSelectProps,
  ref: React.ForwardedRef<GroupSelectRef>,
) {
  const {
    value,
    onChange,
    groupType = GROUP_TYPE.USER,
    defaultAll = false,
    defaultFirst = false,
    disabled = false,
    size = "middle",
    style,
    className,
    placeholder,
    mode,
    multiple,
    onOptionsLoad,
  } = props;

  const [options, setOptions] = useState<GroupOption[]>([]);
  const [loading, setLoading] = useState(false);

  const onChangeRef = useRef(onChange);
  const onOptionsLoadRef = useRef(onOptionsLoad);
  const didApplyDefault = useRef(false);
  const groupTypeRef = useRef(groupType);

  useEffect(() => {
    onChangeRef.current = onChange;
    onOptionsLoadRef.current = onOptionsLoad;
  }, [onChange, onOptionsLoad]);

  useEffect(() => {
    groupTypeRef.current = groupType;
  }, [groupType]);

  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await groupApi.list({
        params: { group_type: groupTypeRef.current },
      });
      const mapped: GroupOption[] = (list || []).map((item: any) => ({
        group_id: item.group_id,
        group_name: item.group_name,
        label: item.group_name,
        value: item.group_id,
      }));
      setOptions(mapped);
      onOptionsLoadRef.current?.(mapped);

      const currentValue = valueRef.current;
      const isEmpty =
        currentValue === undefined ||
        currentValue === null ||
        (Array.isArray(currentValue) && currentValue.length === 0);

      if (!didApplyDefault.current && isEmpty) {
        didApplyDefault.current = true;
        if (defaultAll) {
          const allValues = mapped.map((opt) => opt.group_id);
          setTimeout(() => onChangeRef.current?.(allValues), 0);
        } else if (defaultFirst && mapped.length > 0) {
          setTimeout(() => onChangeRef.current?.([mapped[0].group_id]), 0);
        }
      }
    } catch (error) {
      console.error("Load group options error:", error);
    } finally {
      setLoading(false);
    }
  }, [defaultAll, defaultFirst]);

  useEffect(() => {
    didApplyDefault.current = false;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupType]);

  const prevDefaultAllRef = useRef(defaultAll);
  useEffect(() => {
    if (defaultAll && !prevDefaultAllRef.current) {
      const isEmpty = !value || (Array.isArray(value) && value.length === 0);
      if (isEmpty) {
        const allValues = options.map((opt) => opt.group_id);
        onChangeRef.current?.(allValues);
      }
    }
    prevDefaultAllRef.current = defaultAll;
  }, [defaultAll, value, options]);

  useImperativeHandle(ref, () => ({
    refresh,
  }));

  const handleChange = useCallback((nextValue: number | string | number[] | string[]) => {
    onChangeRef.current?.(nextValue);
  }, []);

  // Default: render select type
  const selectMode = useMemo(() => {
    if (mode) return mode;
    if (multiple) return "multiple";
    return undefined;
  }, [mode, multiple]);

  return (
    <Skeleton className="w-full" active loading={loading}>
      <Select
        mode={selectMode}
        value={value}
        onChange={handleChange}
        options={options.map((opt) => ({
          label: opt.group_name,
          value: opt.group_id,
        }))}
        disabled={disabled}
        size={size}
        style={style}
        className={className}
        placeholder={placeholder || t("form_select_placeholder")}
        allowClear
        maxTagCount="responsive"
      />
    </Skeleton>
  );
}

export const GroupSelect = forwardRef<GroupSelectRef, GroupSelectProps>(
  GroupSelectInner,
);

export default GroupSelect;
