import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useState,
} from "react";
import Sortable from "sortablejs";

export interface SortableChangeArgs {
  action: "sort" | "remove" | "add";
  value: any[];
  prevValue?: any[];
  originSortableId: string;
  targetSortableId: string;
  originData?: any;
  targetData?: any;
  originIndex?: number;
  targetIndex?: number;
  newItem?: any;
  removedItem?: any;
}

export interface SortableProps {
  /** 数据源 */
  value?: any[];
  /** 数据变化回调 */
  onChange?: (value: any[]) => void;
  /** 排序变化回调 */
  onSort?: (args: SortableChangeArgs) => void;
  /** 拖拽开始回调 */
  onDragStart?: (event: any) => void;
  /** 拖拽结束回调 */
  onDragEnd?: (event: any) => void;
  /** 唯一标识字段名，默认 'id' */
  identity?: string;
  /** 拖拽时的背景色 */
  dragBg?: string;
  /** 自定义 sortableId */
  customSortableId?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** sortablejs 配置 */
  sortableProps?: Sortable.Options;
  /** 渲染项 */
  renderItem: (item: any, index: number) => React.ReactNode;
  /** 渲染头部 */
  renderHeader?: () => React.ReactNode;
  /** 渲染底部 */
  renderFooter?: () => React.ReactNode;
  /** 容器样式 */
  style?: React.CSSProperties;
  /** 容器类名 */
  className?: string;
}

export interface SortableRef {
  rerender: () => void;
  scrollToBottom: () => void;
}

const generateId = () => `sort_${Math.random().toString(36).substr(2, 9)}`;

export const SortableComponent = forwardRef<SortableRef, SortableProps>(
  (
    {
      value = [],
      onChange,
      onSort,
      onDragStart,
      onDragEnd,
      identity = "id",
      dragBg = "#ECF5FF",
      customSortableId,
      disabled = false,
      sortableProps,
      renderItem,
      renderHeader,
      renderFooter,
      style,
      className,
    },
    ref
  ) => {
    const [sortableId] = useState(customSortableId || generateId);
    const containerRef = useRef<HTMLDivElement>(null);
    const sortableInstanceRef = useRef<Sortable | null>(null);
    const removingRef = useRef(false);
    const listRef = useRef<any[]>([]);

    // 同步 listRef
    useEffect(() => {
      listRef.current = [...value];
    }, [value]);

    const initSortable = useCallback(() => {
      if (disabled || !containerRef.current) return;

      // 销毁现有实例
      if (sortableInstanceRef.current) {
        sortableInstanceRef.current.destroy();
        sortableInstanceRef.current = null;
      }

      const config: Sortable.Options = {
        animation: 150,
        ...sortableProps,
        onStart: (event: Sortable.SortableEvent) => {
          onDragStart?.(event);
          const { target, oldIndex } = event;
          if (target?.children?.[oldIndex!]) {
            (target.children[oldIndex!] as HTMLElement).style.background = dragBg;
          }
        },
        onEnd: (event: Sortable.SortableEvent) => {
          const { from, to, target, newIndex, oldIndex } = event;
          onDragEnd?.(event);

          if (target?.children?.[newIndex!]) {
            (target.children[newIndex!] as HTMLElement).style.background = "transparent";
          }

          if (from === to && newIndex !== oldIndex) {
            if (removingRef.current) {
              removingRef.current = false;
              return;
            }

            const list = [...listRef.current];
            const prevValue = JSON.parse(JSON.stringify(list));
            const originData = list.splice(oldIndex!, 1)[0];
            const targetData = list[newIndex!];
            list.splice(newIndex!, 0, originData);

            listRef.current = list;
            onChange?.(list);
            onSort?.({
              action: "sort",
              prevValue,
              value: list,
              originSortableId: from.id,
              targetSortableId: to.id,
              originData,
              targetData,
              originIndex: oldIndex,
              targetIndex: newIndex,
            });
          }
        },
        onAdd: (event: Sortable.SortableEvent) => {
          const { from, to, target, newIndex, oldIndex, item } = event;

          if (target?.children?.[newIndex!]) {
            (target.children[newIndex!] as HTMLElement).style.background = "transparent";
          }

          const list = [...listRef.current];
          const newItem = JSON.parse((item as HTMLElement).dataset.sortableData || "{}");
          list.splice(newIndex!, 0, newItem);

          listRef.current = list;
          onChange?.(list);
          onSort?.({
            action: "add",
            value: list,
            originSortableId: from.id,
            targetSortableId: to.id,
            originIndex: oldIndex,
            targetIndex: newIndex,
            newItem,
          });
        },
        onRemove: (event: Sortable.SortableEvent) => {
          const { from, to, target, newIndex, oldIndex } = event;

          if (target?.children?.[newIndex!]) {
            (target.children[newIndex!] as HTMLElement).style.background = "transparent";
          }

          const list = [...listRef.current];
          const removedItem = list.splice(oldIndex!, 1)[0];

          listRef.current = list;
          removingRef.current = true;
          onChange?.(list);
          onSort?.({
            action: "remove",
            value: list,
            originSortableId: from.id,
            targetSortableId: to.id,
            originIndex: oldIndex,
            targetIndex: newIndex,
            removedItem,
          });
        },
      };

      sortableInstanceRef.current = Sortable.create(containerRef.current, config);
    }, [disabled, dragBg, onChange, onDragEnd, onDragStart, onSort, sortableProps]);

    const destroySortable = useCallback(() => {
      if (sortableInstanceRef.current) {
        sortableInstanceRef.current.destroy();
        sortableInstanceRef.current = null;
      }
    }, []);

    useEffect(() => {
      initSortable();
      return destroySortable;
    }, [initSortable, destroySortable]);

    // disabled 变化时重新初始化
    useEffect(() => {
      destroySortable();
      initSortable();
    }, [disabled, destroySortable, initSortable]);

    const scrollToBottom = useCallback(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    }, []);

    const rerender = useCallback(() => {
      destroySortable();
      initSortable();
    }, [destroySortable, initSortable]);

    useImperativeHandle(ref, () => ({
      rerender,
      scrollToBottom,
    }));

    return (
      <div
        ref={containerRef}
        id={sortableId}
        style={style}
        className={className}
      >
        {renderHeader?.()}
        {value.map((item, index) => (
          <div
            key={(item && item[identity]) || index}
            data-sortable-data={JSON.stringify(item)}
          >
            {renderItem(item, index)}
          </div>
        ))}
        {renderFooter?.()}
      </div>
    );
  }
);

SortableComponent.displayName = "Sortable";

export default SortableComponent;