import { Modal, Button, Input, message } from "antd";
import { DeleteOutlined, HolderOutlined } from "@ant-design/icons";
import {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { t } from "@/locales";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Group } from "@/api/modules/group";
import { groupApi, DEFAULT_GROUP_DATA } from "@/api/modules/group";
import type { GroupType } from "@/constants/group";

interface SortableItemProps {
  id: string;
  item: Group;
  index: number;
  onRemove: (index: number) => void;
  onChange: (index: number, value: string) => void;
}

function SortableItem({
  id,
  item,
  index,
  onRemove,
  onChange,
}: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center">
      <div {...attributes} {...listeners} className="pr-3 cursor-move">
        <HolderOutlined style={{ width: 16, height: 32, color: "#a1a5af" }} />
      </div>
      <div className="flex-1">
        <Input
          value={item.group_name}
          onChange={(e) => onChange(index, e.target.value)}
          placeholder="请输入"
          maxLength={10}
          showCount
        />
      </div>
      <DeleteOutlined
        className="ml-4 cursor-pointer"
        style={{ color: "rgba(24, 43, 80, 0.4)" }}
        onClick={() => onRemove(index)}
      />
    </div>
  );
}

export interface GroupDialogProps {
  groupType: GroupType;
  beforeRemove?: (data: Group) => boolean | Promise<boolean>;
  onChange?: (result: { value: Group[] }) => void;
  /** 外部传入的分组数据，如果传入则不会自动加载 */
  options?: Group[];
}

export interface GroupDialogRef {
  open: (options?: { value?: Group[] }) => void;
  close: () => void;
}

export const GroupDialog = forwardRef<GroupDialogRef, GroupDialogProps>(
  ({ groupType, beforeRemove, onChange, options: externalOptions }, ref) => {
    const [visible, setVisible] = useState(false);
    const [options, setOptions] = useState<Group[]>([]);
    const [originalOptions, setOriginalOptions] = useState<Group[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const deletedGroupList = useRef<Group[]>([]);
    const loadedRef = useRef(false);

    const sensors = useSensors(
      useSensor(PointerSensor),
      useSensor(KeyboardSensor, {
        coordinateGetter: sortableKeyboardCoordinates,
      }),
    );

    const refresh = async () => {
      const list = await groupApi.list({ params: { group_type: groupType } });
      const opts = [...list] as Group[];
      setOptions(opts);
      setOriginalOptions(opts);
      if (!opts.length) {
        const defaultOpt = { ...DEFAULT_GROUP_DATA };
        setOptions([defaultOpt]);
      } else {
        onChange?.({ value: opts });
      }
    };

    useEffect(() => {
      // 如果外部传入了数据，使用外部数据，不自动加载
      if (externalOptions && externalOptions.length > 0) {
        setOptions([...externalOptions]);
        setOriginalOptions([...externalOptions]);
        loadedRef.current = true;
        return;
      }
      // 否则自动加载
      if (!loadedRef.current) {
        loadedRef.current = true;
        refresh();
      }
    }, [groupType, externalOptions]);

    const open = async (opts?: { value?: Group[] }) => {
      setSubmitting(false);
      setOptions([]);
      await new Promise((r) => setTimeout(r, 0));
      setOptions([...originalOptions]);
      if (deletedGroupList.current.length) await refresh();
      deletedGroupList.current = [];
      if (opts?.value?.length) setOptions([...opts.value]);
      setVisible(true);
    };

    const close = () => {
      setVisible(false);
    };

    const handleAdd = () => {
      setOptions([
        ...options,
        {
          ...DEFAULT_GROUP_DATA,
          group_id: -Date.now(),
          sort: options.length,
        },
      ]);
    };

    const handleRemove = async (index: number) => {
      const data = options[index];
      if (options.filter((item) => item.group_id).length === 1) {
        message.warning(t("group_min_one"));
        return;
      }

      let intercept = beforeRemove ? beforeRemove(data) : true;
      if (intercept === false) return;
      if (intercept instanceof Promise) {
        const res = await intercept;
        if (res === false) return;
      }

      deletedGroupList.current.push(data);
      const newOptions = [...options];
      newOptions.splice(index, 1);
      setOptions(newOptions);
    };

    const handleChange = (index: number, value: string) => {
      const newOptions = [...options];
      newOptions[index].group_name = value;
      setOptions(newOptions);
    };

    const handleDragEnd = (event: any) => {
      const { active, over } = event;
      if (active.id !== over.id) {
        setOptions((items) => {
          const oldIndex = items.findIndex(
            (item) => String(item.group_id) === active.id,
          );
          const newIndex = items.findIndex(
            (item) => String(item.group_id) === over.id,
          );
          return arrayMove(items, oldIndex, newIndex);
        });
      }
    };

    const handleSave = async () => {
      if (submitting) return;

      const list = options.filter((item) => item.group_name.trim());
      if (!list.length) {
        message.warning(t("group_not_empty"));
        return;
      }

      setSubmitting(true);

      try {
        // Delete removed groups
        for (const item of deletedGroupList.current) {
          if (item.group_id > 0) {
            await groupApi.delete({ data: { group_id: item.group_id } });
          }
        }

        // Save groups
        await groupApi.save({
          data: {
            group_type: groupType,
            groups: list.map((item, index) => ({
              group_name: item.group_name.trim(),
              group_id: item.group_id > 0 ? item.group_id : 0,
              sort: list.length - index,
            })),
          },
        });

        deletedGroupList.current = [];
        message.success(t("action_save_success"));
        groupApi.clearCache(groupType);
        await refresh();
        close();
      } catch (error) {
        console.error("Save groups error:", error);
      } finally {
        setSubmitting(false);
      }
    };

    useImperativeHandle(ref, () => ({
      open,
      close,
    }));

    return (
      <Modal
        open={visible}
        title={t("group_management")}
        onCancel={close}
        width={680}
        destroyOnHidden
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={close}>{t("action_cancel")}</Button>
            <Button type="primary" loading={submitting} onClick={handleSave}>
              {t("action_save")}
            </Button>
          </div>
        }
      >
        <div className="text-dark text-opacity-60 text-sm pb-4">
          {t("display_order")}
        </div>
        <div className="w-full flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={options.map((o) => String(o.group_id))}
              strategy={verticalListSortingStrategy}
            >
              {options.map((item, index) => (
                <SortableItem
                  key={String(item.group_id)}
                  id={String(item.group_id)}
                  item={item}
                  index={index}
                  onRemove={handleRemove}
                  onChange={handleChange}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
        <Button type="link" className="mt-4 ml-5" onClick={handleAdd}>
          +{t("action_add")}
        </Button>
      </Modal>
    );
  },
);

GroupDialog.displayName = "GroupDialog";

export default GroupDialog;
