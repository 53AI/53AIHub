import {
  Switch,
  Button,
  Spin,
  Modal,
  message,
  Table,
  Tooltip,
} from "antd";
import { HolderOutlined } from "@ant-design/icons";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "@/locales";
import { SvgIcon, Search } from "@km/shared-components-react";
import { eventBus, sleep } from "@km/shared-utils";
import { navigationApi } from "@/api/modules/navigation";
import { transformNavigationList } from "@/api/modules/navigation/transform";
import { NAVIGATION_TYPE, NAVIGATION_CONSTANTS } from "@/constants/navigation";
import { VERSION_MODULE } from "@/constants/enterprise";
import { checkVersion } from "@/utils/version";
import type {
  NavigationItem,
  RawNavigationItem,
} from "@/api/modules/navigation/types";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TableProps } from "antd";
import CreateDrawer from "./CreateDrawer";

const MAX_ITEMS = NAVIGATION_CONSTANTS.MAX_ITEMS;

interface SortableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  "data-row-key": string;
}

function SortableRow({ "data-row-key": id, ...props }: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: "grab",
  };

  return (
    <tr
      {...props}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    />
  );
}

export function NavigationPage() {
  const navigate = useNavigate();
  const drawerRef = useRef<{
    open: (params: {
      data?: Partial<NavigationItem>;
      navigationList?: NavigationItem[];
    }) => void;
  }>(null);

  const [navigationList, setNavigationList] = useState<NavigationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const searchKeywordRef = useRef("");
  const lastSearchedKeywordRef = useRef<string | null>(null);
  const lastSearchTimeRef = useRef(0);

  const isAddDisabled = useMemo(
    () => navigationList.length >= MAX_ITEMS,
    [navigationList.length],
  );

  // 检查导航项是否被版本限制
  const isVersionLocked = useCallback((record: NavigationItem) => {
    if (record.jump_path === "/knowledge") {
      return !checkVersion(VERSION_MODULE.KNOWLEDGE_BASE);
    }
    return false;
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 1,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const loadNavigationData = useCallback(
    async (keyword?: string, force?: boolean) => {
      const currentKeyword =
        keyword !== undefined ? keyword : searchKeywordRef.current;
      // 避免重复搜索相同关键词（仅当不是初始化且不是显式传入关键词时，且不是强制刷新）
      if (
        !force &&
        lastSearchedKeywordRef.current !== null &&
        currentKeyword === lastSearchedKeywordRef.current
      ) {
        return;
      }
      lastSearchedKeywordRef.current = currentKeyword;

      setIsLoading(true);
      try {
        const params = {
          offset: 0,
          limit: 10,
          keyword: currentKeyword,
        };

        const rawData = await navigationApi.list(params);

        const transformedList = transformNavigationList(
          rawData as RawNavigationItem[],
        );

        // 仅当原始数据为空时才初始化默认数据（首次使用场景）
        if (!transformedList.length) {
          await navigationApi.init();
          await sleep(1.5);
          await loadNavigationData(currentKeyword, true);
          return;
        }

        const response = {
          total: transformedList.length,
          list: transformedList.filter((item) =>
            item.name.includes(currentKeyword),
          ),
        };

        // 保存完整数据，显示时再根据版本过滤
        setNavigationList(response.list);
      } catch (error) {
        console.error("加载导航数据失败:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const handleSearch = useCallback(
    (keyword?: string) => {
      const now = Date.now();
      // Debounce: prevent duplicate searches within 300ms
      if (now - lastSearchTimeRef.current < 300) {
        return;
      }
      lastSearchTimeRef.current = now;

      const currentKeyword =
        keyword !== undefined ? keyword : searchKeywordRef.current;
      loadNavigationData(currentKeyword, true);
    },
    [loadNavigationData],
  );

  const handleStatusChange = async (row: NavigationItem) => {
    try {
      await navigationApi.updateStatus({
        navigation_id: row.navigation_id,
        status: row.status ? 1 : 0,
      });
      message.success(
        t(row.status ? "action_enable_success" : "action_disable_success"),
      );
    } catch (error) {
      console.error("更新状态失败:", error);
      setNavigationList((prev) =>
        prev.map((item) =>
          item.navigation_id === row.navigation_id
            ? { ...item, status: row.status ? 0 : 1 }
            : item,
        ),
      );
    }
  };

  const handleAdd = (data: NavigationItem | null = null) => {
    drawerRef.current?.open({
      data: data || {},
      navigationList: navigationList,
    });
  };

  const handleEdit = (data: NavigationItem) => {
    handleAdd(data);
  };

  const handlePageEdit = (row: NavigationItem) => {
    navigate(`/navigation/web-setting/${row.navigation_id}`);
  };

  const handleDelete = async (row: NavigationItem) => {
    if (row.type === NAVIGATION_TYPE.SYSTEM) return;

    Modal.confirm({
      title: t("tip"),
      content: t("navigation.delete_confirm"),
      okText: t("action_confirm"),
      cancelText: t("action_cancel"),
      onOk: async () => {
        try {
          await navigationApi.delete(row.navigation_id);
          message.success(t("action_delete_success"));
          loadNavigationData(undefined, true);
        } catch (error) {
          console.error("删除导航失败:", error);
        }
      },
    });
  };

  const handleSortEnd = (event: {
    active: { id: string | number };
    over: { id: string | number } | null;
  }) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = navigationList.findIndex(
      (item) => String(item.navigation_id) === String(active.id),
    );
    const newIndex = navigationList.findIndex(
      (item) => String(item.navigation_id) === String(over.id),
    );

    const oldList = navigationList;
    const newList = [...oldList];
    const [removed] = newList.splice(oldIndex, 1);
    newList.splice(newIndex, 0, removed);

    setNavigationList(newList);

    navigationApi
      .updateSort(
        newList.map((item, index) => ({
          id: item.navigation_id,
          sort: 9999 - index,
        })),
      )
      .then(() => {
        message.success(t("action_sort_success"));
      })
      .catch((error) => {
        console.error("更新排序失败:", error);
        // Rollback UI on error
        setNavigationList(oldList);
      });
  };

  useEffect(() => {
    loadNavigationData();
    eventBus.on("user-login-success", loadNavigationData);
    return () => {
      eventBus.off("user-login-success", loadNavigationData);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns: TableProps<NavigationItem>["columns"] = [
    {
      key: "drag",
      width: 40,
      render: () => <HolderOutlined className="text-placeholder cursor-grab" />,
    },
    {
      title: t("name"),
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (name: string, record) => (
        <div className="flex items-center">
          {record.icon && (
            <img
              className="w-[18px] h-[18px] mr-2 overflow-hidden"
              src={record.icon}
              alt=""
              style={{ objectFit: "contain" }}
            />
          )}
          {name}
        </div>
      ),
    },
    {
      title: t("type"),
      dataIndex: "type_label",
      key: "type",
      width: 100,
      ellipsis: true,
      render: (label: string) => (
        <span className={label ? "" : "text-disabled"}>
          {t(label) || "--"}
        </span>
      ),
    },
    {
      title: t("jump_path"),
      dataIndex: "jump_path",
      key: "jump_path",
      ellipsis: true,
      render: (path: string) => (
        <span className={path ? "" : "text-disabled"}>{path || "--"}</span>
      ),
    },
    {
      title: t("open_method"),
      dataIndex: "target_label",
      key: "target",
      width: 100,
      ellipsis: true,
      render: (label: string) => (
        <span className={label ? "" : "text-disabled"}>
          {t(label) || "--"}
        </span>
      ),
    },
    {
      title: t("navigation_is_open"),
      dataIndex: "status",
      key: "status",
      width: 140,
      render: (status: number, record) => {
        const locked = isVersionLocked(record);
        const switchEl = (
          <Switch
            checked={status === 1}
            disabled={locked}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(checked) => {
              const newItem = { ...record, status: checked ? 1 : 0 };
              setNavigationList((prev) =>
                prev.map((item) =>
                  item.navigation_id === record.navigation_id ? newItem : item,
                ),
              );
              handleStatusChange(newItem);
            }}
          />
        );
        if (locked) {
          return (
            <Tooltip title={t("version.not_support")}>
              {switchEl}
            </Tooltip>
          );
        }
        return switchEl;
      },
    },
    {
      title: t("operation"),
      key: "operation",
      width: 100,
      fixed: "end",
      align: "right",
      render: (_, record) => {
        const locked = isVersionLocked(record);
        return (
          <div
            className="flex items-center justify-end invisible group-hover:visible"
            onClick={(e) => e.stopPropagation()}
          >
            {record.type === NAVIGATION_TYPE.CUSTOM && (
              <Tooltip title={locked ? t("version.not_support") : t("page_edit")}>
                <Button
                  type="text"
                  size="small"
                  disabled={locked}
                  onClick={() => handlePageEdit(record)}
                >
                  <SvgIcon name="edit" color={locked ? "#BDC5D8" : "#5A6D9E"} width="16" />
                </Button>
              </Tooltip>
            )}
            <Tooltip title={locked ? t("version.not_support") : t("action_setting")}>
              <Button
                type="text"
                size="small"
                disabled={locked}
                onClick={() => handleEdit(record)}
              >
                <SvgIcon name="setting-web" color={locked ? "#BDC5D8" : "#5A6D9E"} width="16px" />
              </Button>
            </Tooltip>
            <Tooltip title={t("action_delete")}>
              <Button
                type="text"
                size="small"
                disabled={record.type === NAVIGATION_TYPE.SYSTEM}
                onClick={() => handleDelete(record)}
              >
                <SvgIcon
                  name="delete"
                  color={
                    record.type === NAVIGATION_TYPE.SYSTEM
                      ? "#BDC5D8"
                      : "#5A6D9E"
                  }
                  width="16px"
                />
              </Button>
            </Tooltip>
          </div>
        );
      },
    },
  ];

  return (
    <div className="px-2 h-full flex flex-col overflow-y-auto">
      <div className="flex-1 flex flex-col bg-white box-border max-h-[calc(100vh-100px)] overflow-auto">
        <div className="flex items-center justify-between">
          <Search
            mode="expanded"
            value={searchKeyword}
            onDebouncedChange={(val) => {
              setSearchKeyword(val);
              searchKeywordRef.current = val;
              handleSearch(val);
            }}
            className="max-w-[268px]"
            placeholder={t("navigation.search_placeholder")}
          />
        </div>

        <Spin spinning={isLoading}>
          <div className="flex-1 overflow-y-auto bg-white rounded-lg mt-4">
            {!searchKeyword ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleSortEnd}
              >
                <SortableContext
                  items={navigationList.map((item) =>
                    String(item.navigation_id),
                  )}
                  strategy={verticalListSortingStrategy}
                >
                  <Table
                    rowKey={(record) => String(record.navigation_id)}
                    columns={columns}
                    dataSource={navigationList}
                    pagination={false}
                    className="group"
                    components={{
                      body: {
                        row: SortableRow,
                      },
                    }}
                  />
                </SortableContext>
              </DndContext>
            ) : (
              <Table
                rowKey={(record) => String(record.navigation_id)}
                columns={columns.filter((col) => col.key !== "drag")}
                dataSource={navigationList}
                pagination={false}
                className="group"
              />
            )}

            {!searchKeyword && (
              <Button
                className="mt-4"
                color="primary"
                variant="filled"
                disabled={isAddDisabled}
                onClick={() => handleAdd()}
              >
                + {t("action_add")}（{navigationList.length}/{MAX_ITEMS}）
              </Button>
            )}
          </div>
        </Spin>
      </div>

      <CreateDrawer
        ref={drawerRef}
        onSuccess={() => loadNavigationData(undefined, true)}
      />
    </div>
  );
}

export default NavigationPage;
