import { useState, useRef, useCallback, useEffect } from "react";

interface UseFilterItemOptions<T, IdType extends string | number> {
  getId: (item: T) => IdType;
}

interface UseFilterItemReturn<T, IdType extends string | number> {
  addedItems: T[];
  checkedIds: Set<IdType>;
  addItem: (item: T) => void;
  addItems: (items: T[]) => void;
  removeItem: (id: IdType) => void;
  toggleCheck: (id: IdType) => void;
  getCheckedItems: () => T[];
  reset: () => void;
}

/**
 * 通用筛选项状态管理 Hook
 * 用于管理已添加项和勾选状态
 */
export function useFilterItem<T, IdType extends string | number>(
  options: UseFilterItemOptions<T, IdType>
): UseFilterItemReturn<T, IdType> {
  const { getId } = options;

  const [addedItems, setAddedItems] = useState<T[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<IdType>>(new Set());

  // 添加单项
  const addItem = useCallback(
    (item: T) => {
      const id = getId(item);
      setAddedItems((prev) => {
        if (prev.some((i) => getId(i) === id)) {
          return prev;
        }
        return [...prev, item];
      });
      setCheckedIds((prev) => {
        const newSet = new Set(prev);
        newSet.add(id);
        return newSet;
      });
    },
    [getId],
  );

  // 批量添加
  const addItems = useCallback(
    (items: T[]) => {
      if (items.length === 0) return;

      const existingIds = new Set(addedItems.map((i) => getId(i)));
      const newItems = items.filter((item) => !existingIds.has(getId(item)));

      if (newItems.length > 0) {
        setAddedItems((prev) => [...prev, ...newItems]);
        setCheckedIds((prev) => {
          const newSet = new Set(prev);
          newItems.forEach((item) => newSet.add(getId(item)));
          return newSet;
        });
      }
    },
    [addedItems, getId],
  );

  // 移除项
  const removeItem = useCallback(
    (id: IdType) => {
      setAddedItems((prev) => prev.filter((item) => getId(item) !== id));
      setCheckedIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    },
    [getId],
  );

  // 切换勾选状态
  const toggleCheck = useCallback(
    (id: IdType) => {
      setCheckedIds((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(id)) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
        return newSet;
      });
    },
    [],
  );

  // 获取已勾选的项
  const getCheckedItems = useCallback(() => {
    return addedItems.filter((item) => checkedIds.has(getId(item)));
  }, [addedItems, checkedIds, getId]);

  // 重置
  const reset = useCallback(() => {
    setAddedItems([]);
    setCheckedIds(new Set());
  }, []);

  return {
    addedItems,
    checkedIds,
    addItem,
    addItems,
    removeItem,
    toggleCheck,
    getCheckedItems,
    reset,
  };
}
