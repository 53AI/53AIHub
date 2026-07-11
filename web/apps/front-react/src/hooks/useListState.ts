import { useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";

interface ListStateOptions {
  /** 是否启用 URL 参数序列化（默认 false，关闭时等同于本地 useState） */
  enableUrlSync?: boolean;
  /** URL 参数前缀，避免多页面冲突（仅 enableUrlSync 时生效） */
  urlPrefix?: string;
  /** 搜索字段名（变更时自动重置 page=1，仅 enableUrlSync 时生效） */
  searchFields?: string[];
}

/**
 * 列表页状态管理 Hook
 * - 初始化时从 URL 读取状态
 * - 监听 URL 参数变化（外部导航如刷新、侧边栏点击）
 * - 内部状态变更同步到 URL
 * - 保留其他 URL 参数（不覆盖）
 */
export function useListState<T extends Record<string, any>>(
  defaultState: T,
  options: ListStateOptions = {},
) {
  const { enableUrlSync = false, urlPrefix = "", searchFields = ["keyword"] } = options;

  const [searchParams, setSearchParams] = useSearchParams();

  // 从 URL 解析状态
  const parseStateFromUrl = useCallback((): T => {
    if (!enableUrlSync) return defaultState;
    const result: Partial<T> = {};
    let hasParams = false;

    for (const key in defaultState) {
      const urlKey = urlPrefix + key;
      const value = searchParams.get(urlKey);
      if (value !== null) {
        hasParams = true;
        result[key] = parseValue(value, defaultState[key]);
      }
    }

    return hasParams ? { ...defaultState, ...result } : defaultState;
  }, [searchParams, urlPrefix, defaultState, enableUrlSync]);

  const [state, setState] = useState<T>(parseStateFromUrl);
  const stateRef = useRef<T>(state);

  // 标记是否需要同步 URL（延迟到 effect 中执行）
  const pendingUrlUpdateRef = useRef<T | null>(null);
  // 标记是否是内部更新（避免循环）
  const isInternalUpdateRef = useRef(false);

  // 监听导航变化（侧边栏点击、刷新等）
  useEffect(() => {
    if (!enableUrlSync) return;
    // 如果是内部更新触发的，跳过
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
      return;
    }

    // 外部导航或刷新：从 URL 恢复状态
    const newState = parseStateFromUrl();

    // 只有状态不同时才更新
    if (!stateEquals(stateRef.current, newState)) {
      stateRef.current = newState;
      setState(newState);
    }
  }, [parseStateFromUrl, enableUrlSync]);

  // 延迟同步 URL（在 effect 中执行，避免渲染期间更新）
  useEffect(() => {
    if (!enableUrlSync) return;
    if (pendingUrlUpdateRef.current === null) return;

    const newState = pendingUrlUpdateRef.current;
    pendingUrlUpdateRef.current = null;

    // 标记为内部更新
    isInternalUpdateRef.current = true;

    // 同步 URL：保留当前所有参数，仅更新本 hook 关心的 keys
    const params = new URLSearchParams(searchParams);
    for (const key in newState) {
      const urlKey = urlPrefix + key;
      const value = newState[key];
      if (isEmptyValue(value)) {
        params.delete(urlKey);
      } else {
        params.set(urlKey, serializeValue(value));
      }
    }
    setSearchParams(params, { replace: true });
  }, [state, urlPrefix, searchParams, setSearchParams, enableUrlSync]);

  // 更新状态并标记需要同步 URL
  const updateState = useCallback(
    (updates: Partial<T>) => {
      setState((prev) => {
        let newState = { ...prev, ...updates };

        // 数组去重
        for (const key in updates) {
          if (Array.isArray(newState[key])) {
            newState[key] = [...new Set(newState[key])] as any;
          }
        }

        // 搜索字段变更时重置页码（仅 URL 同步模式生效）
        if (enableUrlSync) {
          const isSearchChange = searchFields.some(
            (field) => field in updates && !arraysEqual(updates[field], prev[field]),
          );
          if (isSearchChange && "page" in newState) {
            (newState as any).page = 1;
          }
        }

        // 同步 ref
        stateRef.current = newState;

        // 标记需要同步 URL（延迟到 effect 中执行）
        if (enableUrlSync) {
          pendingUrlUpdateRef.current = newState;
        }

        return newState;
      });
    },
    [searchFields, enableUrlSync],
  );

  // 重置状态
  const resetState = useCallback(() => {
    stateRef.current = defaultState;
    setState(defaultState);
    if (!enableUrlSync) return;
    pendingUrlUpdateRef.current = defaultState;
    isInternalUpdateRef.current = true;
    // 仅清除本 hook 的 keys，保留其他参数
    const params = new URLSearchParams(searchParams);
    for (const key in defaultState) {
      params.delete(urlPrefix + key);
    }
    setSearchParams(params, { replace: true });
  }, [defaultState, urlPrefix, searchParams, setSearchParams, enableUrlSync]);

  return { state, stateRef, updateState, resetState };
}

// --- 工具函数 ---
function parseValue(value: string, defaultValue: any): any {
  // 处理 "null" 字符串（边界情况）
  if (value === "null" && defaultValue === null) return null;
  if (typeof defaultValue === "number") return Number(value) || defaultValue;
  if (Array.isArray(defaultValue)) {
    const parsed = value.split(",").filter(Boolean);
    // 检查是否应该转换为数字数组：
    // 1. 默认值有元素且第一个是数字
    // 2. 或者解析的值看起来像数字字符串
    const shouldConvertToNumber =
      (defaultValue.length > 0 && typeof defaultValue[0] === "number") ||
      (parsed.length > 0 && parsed.every((v) => !isNaN(Number(v)) && v.trim() !== ""));

    if (shouldConvertToNumber) {
      return parsed.map((v) => Number(v)).filter((n) => !isNaN(n));
    }
    return parsed;
  }
  if (typeof defaultValue === "boolean") return value === "true";
  // 当默认值是 null 但值看起来像数字时，转换为数字（处理时间戳等场景）
  if (defaultValue === null && /^\d+$/.test(value)) return Number(value);
  return value;
}

function serializeValue(value: any): string {
  if (Array.isArray(value))
    return [...new Set(value)].filter((v) => v !== "").join(",");
  return String(value);
}

function isEmptyValue(value: any): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function arraysEqual(a: any, b: any): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, i) => val === sortedB[i]);
}

function stateEquals(a: any, b: any): boolean {
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => {
    const valA = a[key];
    const valB = b[key];
    if (Array.isArray(valA) && Array.isArray(valB)) {
      return arraysEqual(valA, valB);
    }
    return valA === valB;
  });
}
