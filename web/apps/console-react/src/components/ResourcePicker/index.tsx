import { Modal, Button, Table, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { Search } from "@km/shared-components-react";
import "./index.css";
import {
  useRef,
  useState,
  useMemo,
  useCallback,
  forwardRef,
  useImperativeHandle
} from "react";
import { agentApi } from "@/api/modules/agent";
import { aiLinkApi } from "@/api/modules/ai-link";
import promptApi from "@/api/modules/prompt";
import skillApi from "@/api/modules/skill";
import { GROUP_TYPE, type GroupType } from "@/constants/group";
import { GroupTabs } from "@/components/GroupTabs";
import type { ColumnsType } from "antd/es/table";
import { api_host, getPublicPath } from "@/utils/config";

const DEFAULT_SKILL_LOGO = `${api_host}/api/images/skill/logo.png`;

export interface ResourcePickerItem {
  value: number;
  label: string;
  logo?: string;
  name?: string;
  description?: string;
  agent_type_label?: string;
  url?: string;
  [key: string]: any;
}

export interface ResourcePickerRef {
  open: () => void;
  close: () => void;
}

export interface ResourcePickerProps {
  className?: string;
  value?: ResourcePickerItem[];
  /** 值变化回调，参数格式与 Vue 一致: { value: ResourcePickerItem[] } */
  onChange?: (result: { value: ResourcePickerItem[] }) => void;
  /** 确认回调，参数格式与 Vue 一致: { value: ResourcePickerItem[] } */
  onConfirm?: (result: { value: ResourcePickerItem[] }) => void;
  /** 移除回调，参数格式与 Vue 一致: { value: ResourcePickerItem[] } */
  onRemove?: (result: { value: ResourcePickerItem[] }) => void;
  groupType: GroupType;
  /** 对话框标题，不传则使用默认的 "选择" */
  title?: string;
  children?: React.ReactNode;
}

function ResourcePickerInner(
  props: ResourcePickerProps,
  ref: React.ForwardedRef<ResourcePickerRef>,
) {
  const {
    className = "",
    value = [],
    onChange,
    onConfirm,
    onRemove,
    groupType = GROUP_TYPE.AGENT,
    title,
    children,
  } = props;
  const t = (window as any).$t || ((key: string) => key);

  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tableData, setTableData] = useState<any[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  // 跨页选择保存（与 Vue 的 checkedListMap 对应）
  const checkedListMapRef = useRef(new Map<string, any[]>());
  const filterFormRef = useRef({
    group_id: "-1",
    keyword: "",
    page: 1,
    pageSize: 10,
  });

  // ID field name based on group type
  const idName = useMemo(() => {
    if (groupType === GROUP_TYPE.AGENT) return "agent_id";
    if (groupType === GROUP_TYPE.PROMPT) return "prompt_id";
    return "id";
  }, [groupType]);

  // Filter placeholder
  const filterPlaceholder = useMemo(() => {
    if (groupType === GROUP_TYPE.AGENT)
      return t("module.agent_search_placeholder");
    if (groupType === GROUP_TYPE.PROMPT)
      return t("module.prompt_search_placeholder");
    if (groupType === GROUP_TYPE.SKILLS)
      return t("module.skill_search_placeholder");
    return t("website_name");
  }, [groupType, t]);

  // 计算选中列表（与 Vue 的 checkedList computed 对应）
  const checkedList = useMemo(() => {
    let list = Array.from(checkedListMapRef.current.values()).flat();
    // 去重并排除已选中的
    list = list.filter(
      (item, index, self) =>
        index === self.findIndex((t) => t[idName] === item[idName]) &&
        !value.find((row: any) => row[idName] === item[idName]),
    );
    return list;
  }, [selectedRowKeys, value, idName]);

  // Table columns
  const columns: ColumnsType<any> = useMemo(() => {
    if (groupType === GROUP_TYPE.AGENT) {
      return [
        {
          title: t("module.agent"),
          dataIndex: "name",
          key: "name",
          render: (name: string, record) => (
            <div className="flex items-center gap-2">
              <img
                className="w-8 h-8 rounded-full"
                src={record.logo || ""}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).src =
                    getPublicPath("/images/default-avatar.png");
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-brand truncate">{name || "--"}</div>
                {record.description && (
                  <div className="text-xs text-placeholder truncate">
                    {record.description}
                  </div>
                )}
              </div>
            </div>
          ),
        },
        {
          title: t("type"),
          dataIndex: "agent_type_label",
          key: "agent_type_label",
          width: 200,
          render: (label: string) => t(label) || "--",
        },
      ];
    }
    if (groupType === GROUP_TYPE.PROMPT) {
      return [
        {
          title: t("name"),
          dataIndex: "name",
          key: "name",
          width: 260,
          render: (name: string) => (
            <div className="truncate">{name || "--"}</div>
          ),
        },
        {
          title: t("description"),
          dataIndex: "description",
          key: "description",
          render: (desc: string) => desc || "--",
        },
      ];
    }
    if (groupType === GROUP_TYPE.SKILLS) {
      return [
        {
          title: t("module.skill"),
          dataIndex: "display_name",
          key: "display_name",
          minWidth: 200,
          render: (displayName: string, record) => (
            <div className="flex items-center gap-2 w-full">
              <img
                className="flex-none w-8 h-8 rounded overflow-hidden"
                src={record.logo || DEFAULT_SKILL_LOGO}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).src = DEFAULT_SKILL_LOGO;
                }}
              />
              <div className="flex-1 w-0 text-sm flex flex-col">
                <div className="text-brand truncate">
                  {record.skill_name || "--"}
                </div>
                {record.description && (
                  <div className="text-xs text-placeholder truncate">
                    {record.description}
                  </div>
                )}
              </div>
            </div>
          ),
        },
        {
          title: t("skills.display_name"),
          dataIndex: "display_name",
          key: "display_name",
          minWidth: 300,
          render: (desc: string) => desc || "--",
        },
      ];
    }
    // AI Link
    return [
      {
        title: t("module.ai_product"),
        dataIndex: "name",
        key: "name",
        render: (name: string, record) => (
          <div className="flex items-center gap-2">
            <img
              className="w-8 h-8 rounded-full"
              src={record.logo || ""}
              alt=""
            />
            <div className="text-brand truncate">{name || "--"}</div>
          </div>
        ),
      },
      {
        title: t("jump_path"),
        dataIndex: "url",
        key: "url",
        width: 300,
        render: (url: string) => url || "--",
      },
    ];
  }, [groupType, t]);

  // Fetch data
  const fetchData = useCallback(async () => {
    const { group_id, keyword, page, pageSize } = filterFormRef.current;
    setLoading(true);

    try {
      let data = { count: 0, list: [] as any[] };

      if (groupType === GROUP_TYPE.AGENT) {
        const res = await agentApi.list({
          params: {
            group_id,
            keyword,
            offset: (page - 1) * pageSize,
            limit: pageSize,
          },
        });
        data = { count: res.count || 0, list: res.agents || [] };
      } else if (groupType === GROUP_TYPE.PROMPT) {
        const res = await promptApi.list({
          params: {
            group_id,
            keyword,
            offset: (page - 1) * pageSize,
            limit: pageSize,
          },
        });
        data = { count: res.total || 0, list: res.list || [] };
      } else if (groupType === GROUP_TYPE.SKILLS) {
        const params: any = {
          offset: (page - 1) * pageSize,
          limit: pageSize,
          publish_status: "published",
          admin_status: "enabled",
        };
        if (+group_id !== -1) {
          params.group_id = +group_id;
        }
        if (keyword) {
          params.keyword = keyword;
        }
        const res = await skillApi.list({ params });
        data = { count: res.total || 0, list: res.list || [] };
      } else {
        const group_id_num = +group_id;
        const list = await aiLinkApi.list({
          params: {
            group_id: group_id_num > 0 ? [group_id_num] : [],
            keyword,
          },
        });
        // AI Link 返回全量数据，total 设为 undefined 让 antd 客户端分页
        data = { count: undefined as any, list: list || [] };
      }

      setTableTotal(data.count);
      const processedData = data.list.map((item: any) => ({
        ...item,
        value: +item[idName] || 0,
        label: item.name || item.display_name || "",
      }));
      setTableData(processedData);

      // 恢复当前页已选择项的选中状态
      const currentCheckedList = checkedListMapRef.current.get(group_id) || [];
      const keysToSelect: number[] = [];
      processedData.forEach((item: any) => {
        const isInCheckedList = currentCheckedList.some(
          (c: any) => c[idName] === item[idName],
        );
        if (isInCheckedList) {
          keysToSelect.push(item[idName]);
        }
        // 已选项显示为选中状态
        if (value.some((v) => v[idName] === item[idName])) {
          keysToSelect.push(item[idName]);
        }
      });
      setSelectedRowKeys(keysToSelect);
    } catch (error) {
      console.error("Fetch data error:", error);
    } finally {
      setLoading(false);
    }
  }, [groupType, idName, value]);

  // Open dialog
  const open = useCallback(() => {
    checkedListMapRef.current = new Map();
    setSelectedRowKeys([]);
    setTableData([]); // 清空旧数据，避免切换 groupType 后 rowKey 不匹配
    setTableTotal(0);
    filterFormRef.current = {
      group_id: "-1",
      keyword: "",
      page: 1,
      pageSize: 10,
    };
    setVisible(true);
    setTimeout(() => fetchData(), 0);
  }, [fetchData]);

  // Close dialog
  const close = useCallback(() => {
    setVisible(false);
  }, []);

  // Refresh
  const refresh = useCallback(() => {
    filterFormRef.current.page = 1;
    fetchData();
  }, [fetchData]);

  // Handle confirm
  const handleConfirm = useCallback(() => {
    const resultValue = JSON.parse(JSON.stringify(checkedList));
    onChange?.({ value: resultValue });
    onConfirm?.({ value: resultValue });
    close();
  }, [checkedList, onChange, onConfirm, close]);

  // Handle remove
  const handleRemove = useCallback(
    (item: ResourcePickerItem) => {
      const newValue = value.filter((v) => v.value !== item.value);
      onChange?.({ value: newValue }); // 与 Vue 保持一致，触发 onChange
      onRemove?.({ value: [item] });
    },
    [value, onChange, onRemove],
  );

  // Handle table change
  const handleTableChange = useCallback(
    (pagination: any) => {
      filterFormRef.current.page = pagination.current;
      filterFormRef.current.pageSize = pagination.pageSize;
      fetchData();
    },
    [fetchData],
  );

  // Handle group change
  const handleGroupChange = useCallback(() => {
    refresh();
  }, [refresh]);

  // Handle keyword change
  const handleKeywordChange = useCallback(
    (val: string) => {
      filterFormRef.current.keyword = val;
      refresh();
    },
    [refresh],
  );

  // Handle selection change
  const handleSelectionChange = useCallback(
    (keys: React.Key[], rows: any[]) => {
      if (loading) return;
      setSelectedRowKeys(keys as number[]);
      // 保存到 checkedListMap（与 Vue 的 onSelectionChange 对应）
      checkedListMapRef.current.set(filterFormRef.current.group_id, [...rows]);
    },
    [loading],
  );

  // Row selection
  const rowSelection = useMemo(
    () => ({
      selectedRowKeys,
      onChange: handleSelectionChange,
      getCheckboxProps: (record: any) => ({
        disabled: value.some((v) => v[idName] === record[idName]),
      }),
    }),
    [selectedRowKeys, value, idName, handleSelectionChange],
  );

  useImperativeHandle(ref, () => ({
    open,
    close,
  }));

  return (
    <div className={className}>
      {children ? (
        <div onClick={open}>{children}</div>
      ) : (
        <div className="w-full flex items-center flex-wrap gap-2">
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            className="!bg-transparent !border-[#3664EF] !text-brand"
            size="small"
            onClick={open}
          >
            {t("action_add")}
          </Button>
          {value.map((item, index) => (
            <Tag
              key={`${item.value}-${index}`}
              closable
              onClose={() => handleRemove(item)}
              className="!border-[#91B8FF] !bg-[#E6F4FF] !text-primary"
            >
              {item.logo && (
                <img
                  className="w-4 h-4 inline-block object-contain rounded-full mr-2"
                  src={item.logo}
                  alt=""
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              <span className="text-primary">{item.label}</span>
            </Tag>
          ))}
        </div>
      )}

      <Modal
        title={title ?? t("action_select")}
        open={visible}
        onCancel={close}
        footer={
          <div className="flex items-center justify-between">
            <div className="text-sm text-hint text-left">
              已选择 <span className="text-brand">{value.length + checkedList.length}</span> 个
            </div>
            <div className="flex gap-2">
              <Button onClick={close}>{t("action_cancel")}</Button>
              <Button
                type="primary"
                loading={loading}
                disabled={checkedList.length === 0}
                onClick={handleConfirm}
              >
                {t("action_confirm")}
              </Button>
            </div>
          </div>
        }
        width={800}
        styles={{ body: { maxHeight: "72vh", overflow: "hidden" } }}
        destroyOnHidden
      >
        <div className="w-full flex items-center justify-between gap-4 mb-5">
          <div className="flex-1 w-[380px]">
            <GroupTabs
              value={filterFormRef.current.group_id}
              onChange={(group_id) => {
                filterFormRef.current.group_id = group_id;
                handleGroupChange();
              }}
              groupType={groupType}
            />
          </div>
          <Search
            mode="expanded"
            value={filterFormRef.current.keyword}
            onDebouncedChange={handleKeywordChange}
            className="w-[220px]"
            placeholder={filterPlaceholder}
          />
        </div>

          <Table
            rowKey={idName}
            columns={columns}
            dataSource={tableData}
            loading={loading}
            rowSelection={rowSelection}
            pagination={
              tableTotal
                ? {
                    current: filterFormRef.current.page,
                    pageSize: filterFormRef.current.pageSize,
                    total: tableTotal,
                    showSizeChanger: true,
                    showTotal: (total: number) => `共 ${total} 条`,
                  }
                : {
                    current: filterFormRef.current.page,
                    pageSize: filterFormRef.current.pageSize,
                    showSizeChanger: true,
                  }
            }
          scroll={{ y: "calc(56vh - 64px)" }}
            onChange={handleTableChange}
            components={{
              header: {
                cell: (props: any) => (
                  <th {...props} className="!bg-[#F6F7F8] !border-none" />
                ),
              },
              body: {
                row: (props: any) => {
                  const { className, ...rest } = props;
                  return (
                    <tr
                      {...rest}
                      className={`${className || ""} resource-picker-row`}
                    />
                  );
                },
              },
            }}
          />
      </Modal>
    </div>
  );
}

export const ResourcePicker = forwardRef<
  ResourcePickerRef,
  ResourcePickerProps
>(ResourcePickerInner);

export default ResourcePicker;
