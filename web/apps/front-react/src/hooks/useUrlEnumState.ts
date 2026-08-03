import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

interface UseUrlEnumStateOptions<T extends string> {
  /** URL query 参数名 */
  urlKey: string;
  /** 合法值列表（用于校验 URL 中读到的值） */
  validValues: readonly T[];
  /** 默认值；写入此值时不写入 URL（保持 URL 干净） */
  defaultValue: T;
}

/**
 * URL 序列化的枚举状态。
 *
 * 与 useListState 的区别：useListState 面向分页列表场景（多字段、搜索重置页码等）；
 * 本 hook 仅面向 "tab 切换 / 子视图切换" 这种单 key 枚举场景，写法更轻。
 *
 * 行为：
 * - 初始化从 URL 读取（无效值回退到 defaultValue）
 * - 写入 defaultValue 时从 URL 删除 key
 * - 浏览器前进/后退、刷新等外部 URL 变更会同步回 state
 */
export function useUrlEnumState<T extends string>(
  options: UseUrlEnumStateOptions<T>,
): readonly [T, (next: T) => void] {
  const { urlKey, validValues, defaultValue } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  const readFromUrl = useCallback((): T => {
    const v = searchParams.get(urlKey);
    return v && (validValues as readonly string[]).includes(v)
      ? (v as T)
      : defaultValue;
  }, [searchParams, urlKey, validValues, defaultValue]);

  const [value, setValueState] = useState<T>(readFromUrl);

  // 内部更新标记，避免被同步 effect 当成外部变更再写一次
  const isInternalUpdateRef = useRef(false);

  // 外部 URL 变更（浏览器前进/后退、其他组件 setSearchParams）→ 同步到 state
  useEffect(() => {
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
      return;
    }
    const next = readFromUrl();
    setValueState((prev) => (prev === next ? prev : next));
  }, [readFromUrl]);

  const setValue = useCallback(
    (next: T) => {
      setValueState(next);
      isInternalUpdateRef.current = true;
      setSearchParams(
        (prev) => {
          if (next === defaultValue) prev.delete(urlKey);
          else prev.set(urlKey, next);
          return prev;
        },
        { replace: true },
      );
    },
    [defaultValue, urlKey, setSearchParams],
  );

  return [value, setValue] as const;
}