import { Select, Checkbox, Radio, Skeleton } from "antd";
import { useEffect, useMemo, useRef, useState, forwardRef, useCallback, useImperativeHandle } from "react";
import { t } from "@/locales";
import groupApi from "@/api/modules/group";
import { GROUP_TYPE, type GroupType } from "@/constants/group";
import { DeptMemberPicker } from "@/components/DeptMemberPicker";
import type { ScopeItem } from "@km/shared-business/agent-create";

export interface GroupSelectProps {
  value?: number | string | number[] | string[] | null;
  onChange?: (value: number | string | number[] | string[] | null) => void;
  onConfirm?: (value: number | string | number[] | string[] | null) => void;
  groupType?: GroupType;
  type?: "select" | "checkbox" | "picker" | "radio" | "scope";
  defaultAll?: boolean;
  defaultFirst?: boolean;
  defaultFirstValue?: boolean;
  disabled?: boolean;
  size?: "large" | "middle" | "small";
  style?: React.CSSProperties;
  className?: string;
  placeholder?: string;
  // Backward compatibility props
  mode?: "multiple" | "tags";
  multiple?: boolean;
  onOptionsLoad?: (options: GroupOption[]) => void;
  children?: React.ReactNode; // trigger slot for picker type
}

export interface GroupOption {
  group_id: number;
  group_name: string;
  label: string;
  value: number;
}

export interface GroupSelectRef {
  refresh: () => Promise<void>;
  open: () => void;
  close: () => void;
}

function GroupSelectInner(
  props: GroupSelectProps,
  ref: React.ForwardedRef<GroupSelectRef>,
) {
  const {
    value,
    onChange,
    onConfirm,
    groupType = GROUP_TYPE.USER,
    type = "select",
    defaultAll = false,
    defaultFirst = false,
    defaultFirstValue = false,
    disabled = false,
    size = "middle",
    style,
    className,
    placeholder,
    mode,
    multiple,
    onOptionsLoad,
    children,
  } = props;

  const [options, setOptions] = useState<GroupOption[]>([]);
  const [loading, setLoading] = useState(false);

  const onChangeRef = useRef(onChange);
  const onConfirmRef = useRef(onConfirm);
  const onOptionsLoadRef = useRef(onOptionsLoad);
  const didApplyDefault = useRef(false);
  const groupTypeRef = useRef(groupType);

  useEffect(() => {
    onChangeRef.current = onChange;
    onConfirmRef.current = onConfirm;
    onOptionsLoadRef.current = onOptionsLoad;
  }, [onChange, onConfirm, onOptionsLoad]);

  useEffect(() => {
    groupTypeRef.current = groupType;
  }, [groupType]);

  const normalizedValue = useMemo(() => {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
  }, [value]);

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
          const defaultValue =
            type === "radio" ? mapped[0].group_id : [mapped[0].group_id];
          setTimeout(() => onChangeRef.current?.(defaultValue), 0);
        }
      }
    } catch (error) {
      console.error("Load group options error:", error);
    } finally {
      setLoading(false);
    }
  }, [defaultAll, defaultFirst, type]);

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

  const pickerRef = useRef<{ open: () => void; close: () => void }>(null);
  const open = useCallback(() => {
    pickerRef.current?.open();
  }, []);
  const close = useCallback(() => {
    pickerRef.current?.close();
  }, []);

  useImperativeHandle(ref, () => ({
    refresh,
    open,
    close,
  }));

  const handleChange = useCallback((nextValue: number | string | number[] | string[]) => {
    onChangeRef.current?.(nextValue);
  }, []);

  // Render picker type - fully delegate to DeptMemberPicker
  if (type === "picker") {
    const pickerValue = Array.isArray(value) ? value as number[] : value ? [value as number] : [];
    return (
      <DeptMemberPicker
        ref={pickerRef}
        value={pickerValue}
        onChange={(val) => onChangeRef.current?.(val as number[])}
        onConfirm={(result) => onConfirmRef.current?.(result.value as number[])}
        type="group"
        groupType={groupType}
        defaultAll={defaultAll}
        defaultFirst={defaultFirst}
        simpleValue
        trigger={children || undefined}
      />
    );
  }

  // Render scope type - delegate to DeptMemberPicker with scope mode
  if (type === "scope") {
    return (
      <DeptMemberPicker
        ref={pickerRef}
        value={value as ScopeItem[]}
        onChange={(val) => onChangeRef.current?.(val as ScopeItem[])}
        onConfirm={(result) => onConfirmRef.current?.(result.value as ScopeItem[])}
        type="scope"
        defaultFirstValue={defaultFirstValue}
        defaultAll={defaultAll}
        simpleValue
        multiple
        trigger={children || undefined}
      />
    );
  }

  // Render radio type
  if (type === "radio") {
    return (
      <Skeleton className="w-full" active loading={loading}>
        <Radio.Group
          value={value as number}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled}
          className={className}
          style={style}
        >
          {options.map((opt) => (
            <Radio key={opt.group_id} value={opt.group_id}>
              <span className="text-primary">{opt.group_name}</span>
            </Radio>
          ))}
        </Radio.Group>
      </Skeleton>
    );
  }

  // Render checkbox type
  if (type === "checkbox") {
    return (
      <Skeleton className="w-full" active loading={loading}>
        <Checkbox.Group
          value={normalizedValue}
          onChange={(vals) => handleChange(vals as number[])}
          disabled={disabled}
          className={className}
          style={style}
        >
          {options.map((opt) => (
            <Checkbox key={opt.group_id} value={opt.group_id}>
              <span className="text-primary">{opt.group_name}</span>
            </Checkbox>
          ))}
        </Checkbox.Group>
      </Skeleton>
    );
  }

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
