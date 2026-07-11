import {
    DndContext,
    PointerSensor,
    closestCenter,
    useDroppable,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragOverEvent,
} from "@dnd-kit/core";

import { useState, type ReactNode } from "react";
import {
    SortableContext,
    arrayMove,
    rectSortingStrategy,
    useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type {
    SortableGroup,
    SortableHandleProps,
    SortableItem,
    SortableItemId,
} from "./types";

const dragHandleClass = ".sort-icon";

export interface SortableGroupGridProps<T = unknown> {
  groups: SortableGroup<T>[];
  renderItem: (item: T, handleProps?: SortableHandleProps) => ReactNode;
  onChange: (nextGroups: SortableGroup<T>[]) => void;
  sortable?: boolean;
  showGroupTitle?: boolean;
  dragHandleClassName?: string;
}

const getGroupByItemId = <T,>(
  groups: SortableGroup<T>[],
  itemId: SortableItemId,
) => groups.find((group) => group.items.some((item) => item.id === itemId));

const getGroupById = <T,>(
  groups: SortableGroup<T>[],
  groupId: number | string,
) => groups.find((group) => group.id === groupId);

const SortableItemCard = <T,>({
  id,
  children,
  disabled,
  dragHandleClassName,
}: {
  id: SortableItemId;
  children: (handleProps?: SortableHandleProps) => ReactNode;
  disabled: boolean;
  dragHandleClassName?: string;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const handleProps = dragHandleClassName
    ? {
        attributes,
        listeners,
        setActivatorNodeRef,
        dragHandleClassName,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(!dragHandleClassName ? { ...attributes, ...listeners } : undefined)}
    >
      {children(handleProps)}
    </div>
  );
};

const GroupDropZone = ({
  id,
  children,
}: {
  id: number | string;
  children: ReactNode;
}) => {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} data-group-id={id}>
      {children}
    </div>
  );
};

export const SortableGroupGrid = <T,>({
  groups,
  renderItem,
  onChange,
  sortable = true,
  showGroupTitle = true,
  dragHandleClassName = dragHandleClass,
}: SortableGroupGridProps<T>) => {
  // Internal drag state management to prevent parent re-renders during drag
  const [internalGroups, setInternalGroups] = useState<
    SortableGroup<T>[] | null
  >(null);
  const [activeId, setActiveId] = useState<string | number | null>(null);

  // Use internal state during drag, external groups otherwise
  const renderGroups =
    activeId !== null && internalGroups !== null ? internalGroups : groups;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

  const handleDragOver = (event: DragOverEvent) => {
    if (!sortable) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeItemId = active.id as SortableItemId;
    const overId = over.id as SortableItemId;

    // Use current render groups (could be internal state during drag)
    const currentGroups =
      activeId !== null && internalGroups !== null ? internalGroups : groups;

    const activeGroup = getGroupByItemId(currentGroups, activeItemId);
    const overGroup =
      getGroupByItemId(currentGroups, overId) ||
      getGroupById(currentGroups, overId);

    if (!activeGroup || !overGroup || activeGroup.id === overGroup.id) return;

    const activeItem = activeGroup.items.find(
      (item) => item.id === activeItemId,
    ) as SortableItem<T>;
    if (!activeItem) return;

    const nextGroups = currentGroups.map((group) => {
      if (group.id === activeGroup.id) {
        return {
          ...group,
          items: group.items.filter((item) => item.id !== activeItemId),
        };
      }
      if (group.id === overGroup.id) {
        const overIndex = group.items.findIndex((item) => item.id === overId);
        const nextItems = [...group.items];
        if (overIndex === -1) {
          nextItems.push(activeItem);
        } else {
          nextItems.splice(overIndex, 0, activeItem);
        }
        return {
          ...group,
          items: nextItems,
        };
      }
      return group;
    });

    // Update internal state to trigger re-render without parent update
    setActiveId(activeItemId);
    setInternalGroups(nextGroups);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (!sortable) return;
    const { active, over } = event;

    // Save current internal state
    const finalInternalGroups = internalGroups;
    const finalActiveId = activeId;

    // Clear internal state
    setActiveId(null);
    setInternalGroups(null);

    if (!over || active.id === over.id) return;

    const activeItemId = active.id as SortableItemId;
    const overId = over.id as SortableItemId;

    // If already processed in dragOver, use internal state
    if (finalInternalGroups !== null) {
      const activeGroup = getGroupByItemId(finalInternalGroups, activeItemId);

      if (!activeGroup) {
        onChange(finalInternalGroups);
        return;
      }

      const overGroup = getGroupByItemId(finalInternalGroups, overId);
      const isSameGroup = overGroup && overGroup.id === activeGroup.id;

      if (isSameGroup) {
        // Final position adjustment within same group
        const oldIndex = activeGroup.items.findIndex(
          (item) => item.id === activeItemId,
        );
        const newIndex = activeGroup.items.findIndex(
          (item) => item.id === overId,
        );
        if (oldIndex === -1 || newIndex === -1) {
          onChange(finalInternalGroups);
          return;
        }
        const nextItems = arrayMove(activeGroup.items, oldIndex, newIndex);
        const nextGroups = finalInternalGroups.map((group) =>
          group.id === activeGroup.id ? { ...group, items: nextItems } : group,
        );
        onChange(nextGroups);
        return;
      }

      // Cross-group drag completed
      onChange(finalInternalGroups);
      return;
    }

    // Original logic: same-group sorting without dragOver
    const activeGroup = getGroupByItemId(groups, activeItemId);
    if (!activeGroup) return;

    const overGroup = getGroupByItemId(groups, overId);
    const isSameGroup = overGroup && overGroup.id === activeGroup.id;

    if (isSameGroup) {
      const oldIndex = activeGroup.items.findIndex(
        (item) => item.id === activeItemId,
      );
      const newIndex = activeGroup.items.findIndex(
        (item) => item.id === overId,
      );
      if (oldIndex === -1 || newIndex === -1) return;
      const nextItems = arrayMove(activeGroup.items, oldIndex, newIndex);
      const nextGroups = groups.map((group) =>
        group.id === activeGroup.id ? { ...group, items: nextItems } : group,
      );
      onChange(nextGroups);
      return;
    }

    const fallbackGroup = getGroupById(groups, overId);
    if (!fallbackGroup || fallbackGroup.id === activeGroup.id) return;

    const activeItem = activeGroup.items.find(
      (item) => item.id === activeItemId,
    );
    if (!activeItem) return;

    const nextGroups = groups.map((group) => {
      if (group.id === activeGroup.id) {
        return {
          ...group,
          items: group.items.filter((item) => item.id !== activeItemId),
        };
      }
      if (group.id === fallbackGroup.id) {
        return {
          ...group,
          items: [...group.items, activeItem],
        };
      }
      return group;
    });

    onChange(nextGroups);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col gap-6">
        {renderGroups.map((group) => (
          <div key={group.id} className="flex flex-col gap-3">
            {showGroupTitle && group.title ? (
              <div className="text-secondary text-opacity-60 text-sm">
                {group.title}
              </div>
            ) : null}
            <GroupDropZone id={group.id}>
              <SortableContext
                items={group.items.map((item) => item.id)}
                strategy={rectSortingStrategy}
              >
                <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-3 max-md:grid-cols-2 max-sm:grid-cols-1">
                  {group.items.map((item) => (
                    <SortableItemCard
                      key={item.id}
                      id={item.id}
                      disabled={!sortable}
                      dragHandleClassName={dragHandleClassName}
                    >
                      {(handleProps) => renderItem(item.data, handleProps)}
                    </SortableItemCard>
                  ))}
                  {!group.items.length ? (
                    <div className="min-h-[1px]" data-group-id={group.id} />
                  ) : null}
                </div>
              </SortableContext>
            </GroupDropZone>
          </div>
        ))}
      </div>
    </DndContext>
  );
};

export default SortableGroupGrid;
