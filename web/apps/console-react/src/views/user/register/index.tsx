import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Table,
  Button,
  Select,
  message,
  Modal
} from "antd";
import { MoreOutlined } from "@ant-design/icons";
import { SvgIcon, Dropdown, Search } from "@km/shared-components-react";
import { t } from "@/locales";
import { groupApi } from "@/api";
import { useUserStore, useEnterpriseStore } from "@/stores";
import { useEnv } from "@/hooks/useEnv";
import { GROUP_TYPE } from "@/constants/group";
import UserAddDialog from "../components/UserAddDialog";
import UserStatus from "../components/UserInternalStatus";
import { DialogueRecordDrawer } from "@/components/DialogueRecord/drawer";
import type { DialogueRecordDrawerRef } from "@/components/DialogueRecord/drawer";
import { DateRangeFilter } from "@/components/Filter/date-range";
import type { ColumnsType } from "antd/es/table";

// Types
interface RegisterUser {
  user_id: number;
  nickname: string;
  mobile: string;
  email: string;
  group_id: number;
  subscription_name: string;
  expired_time: string;
  register_time: string;
  status: number;
}

export function UserRegisterList() {
  const userStore = useUserStore();
  const enterpriseStore = useEnterpriseStore();
  const { isWorkEnv } = useEnv();

  const [loading, setLoading] = useState(false);
  const [tableData, setTableData] = useState<RegisterUser[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [keyword, setKeyword] = useState("");
  const keywordRef = useRef(keyword);
  keywordRef.current = keyword;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Filters
  const [groupId, setGroupId] = useState(0);
  const [rangeBy, setRangeBy] = useState("expired_time");
  const [dateRange, setDateRange] = useState<(string | number)[]>([]);

  // Options
  const [subscriptionOptions, setSubscriptionOptions] = useState<
    { value: number; label: string; group_id?: number; group_name?: string }[]
  >([]);

  // Dialog/Drawer state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<RegisterUser | null>(null);
  const dialogueRecordRef = useRef<DialogueRecordDrawerRef>(null);

  // Range options
  const rangeOptions = useMemo(
    () => [
      { value: "created_time", label: t("register_time") },
      { value: "expired_time", label: t("subscription.end_at") },
    ],
    [],
  );

  // User info
  const userInfo = useMemo(() => userStore.info, [userStore.info]);

  // Check if independent or industry
  const showSubscriptionTabs = useMemo(
    () =>
      enterpriseStore.info?.is_independent || enterpriseStore.info?.is_industry,
    [enterpriseStore.info],
  );

  // Load subscription options
  const loadSubscriptionOptions = async () => {
    const list = await groupApi.list({
      params: { group_type: GROUP_TYPE.USER },
    });
    const options = list.map((item: any) => ({
      value: +item.group_id || 0,
      label: item.group_name || "",
      ...item,
    }));
    options.unshift({ value: 0, label: t("all") });
    setSubscriptionOptions(options);
  };

  // Load user list
  const loadUserList = useCallback(async (params?: { page?: number }) => {
    const currentPage = params?.page ?? page;
    setLoading(true);
    try {
      const res = await userStore.loadListData({
        data: {
          keyword: keywordRef.current,
          group_id: groupId,
          offset: (currentPage - 1) * pageSize,
          start_time: dateRange[0] || undefined,
          end_time: dateRange[1] || undefined,
          range_by: rangeBy,
          limit: pageSize,
        },
      });

      const formattedList = res.list.map((item: any) => {
        const subscription = subscriptionOptions.find(
          (opt) => opt.group_id === item.group_id,
        );
        return {
          ...item,
          subscription_name: subscription?.group_name || "",
        };
      });

      setTableData(formattedList);
      setTableTotal(res.total);
    } catch (error) {
      console.error("Load user list error:", error);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, groupId, rangeBy, dateRange, subscriptionOptions]);

  // Refresh
  const refresh = () => {
    if (page === 1) {
      loadUserList({ page: 1 });
    } else {
      setPage(1);
    }
  };

  // Handle edit
  const handleEdit = (record: RegisterUser) => {
    setEditingUser(record);
    setAddDialogOpen(true);
  };

  // Handle delete
  const handleDelete = async (record: RegisterUser) => {
    Modal.confirm({
      title: t("tip"),
      content: t("module.operation_user_delete_confirm"),
      onOk: async () => {
        try {
          await userStore.delete({ data: { user_id: String(record.user_id) } });
          message.success(t("action_delete_success"));
          loadUserList();
        } catch (error) {
          console.error("Delete user error:", error);
        }
      },
    });
  };

  // Handle more command
  const handleMoreCommand = (key: string, record: RegisterUser) => {
    switch (key) {
      case "dialogue_record":
        dialogueRecordRef.current?.open({
          type: "user",
          relatedId: record.user_id,
        });
        break;
      case "delete":
        handleDelete(record);
        break;
    }
  };

  // Handle row click
  const handleRowClick = (record: RegisterUser) => {
    handleEdit(record);
  };

  // Table columns
  const columns: ColumnsType<RegisterUser> = useMemo(
    () => [
      {
        title: t("user"),
        dataIndex: "nickname",
        key: "nickname",
        width: 140,
        ellipsis: true,
      },
      {
        title: t("mobile"),
        dataIndex: "mobile",
        key: "mobile",
        width: 140,
        render: (value: string) => (
          <span className={!value ? "text-gray-400" : ""}>{value || "--"}</span>
        ),
      },
      {
        title: t("email"),
        dataIndex: "email",
        key: "email",
        width: 140,
        render: (value: string) => (
          <span className={!value ? "text-gray-400" : ""}>{value || "--"}</span>
        ),
      },
      {
        title: t("subscription.title"),
        dataIndex: "subscription_name",
        key: "subscription",
        width: 100,
        render: (value: string) => (
          <span className={!value ? "text-gray-400" : ""}>{value || "--"}</span>
        ),
      },
      {
        title: t("subscription.end_at"),
        dataIndex: "expired_time",
        key: "expired_time",
        width: 120,
        render: (value: string, record) => (
          <span className={!value ? "text-gray-400" : ""}>
            {(value || "").slice(0, 10) ||
              (+record.group_id && t("permanent_effect")) ||
              "--"}
          </span>
        ),
      },
      {
        title: t("internal_user.account.status"),
        dataIndex: "status",
        key: "status",
        width: 160,
        render: (value: number, record: RegisterUser) => (
          <UserStatus
            value={value}
            userData={record}
            buttonDisabled={
              record.user_id === userInfo?.user_id || record.is_creator
            }
            onChange={() => loadUserList()}
          />
        ),
      },
      {
        title: t("register_time"),
        dataIndex: "register_time",
        key: "register_time",
        width: 160,
        render: (value: string) => (
          <span className={!value ? "text-gray-400" : ""}>
            {(value || "").slice(0, 16) || "--"}
          </span>
        ),
      },
      {
        title: t("operation"),
        key: "operation",
        width: 120,
        fixed: "end",
        render: (_: any, record: RegisterUser) => (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
            <Button
              type="link"
              icon={<SvgIcon name="edit" />}
              onClick={(e) => {
                e.stopPropagation();
                handleEdit(record);
              }}
            />
            {isWorkEnv ? (
              <Button
                type="link"
                danger
                icon={<SvgIcon name="delete" />}
                disabled={record.user_id === userInfo.user_id}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(record);
                }}
              >
                {record.user_id === userInfo.user_id
                  ? "--"
                  : t("action_delete")}
              </Button>
            ) : (
              <Dropdown
                menu={{
                  items: [
                    {
                      key: "dialogue_record",
                      label: t("dialogue_record"),
                    },
                    {
                      key: "delete",
                      label: t("action_delete"),
                      danger: true,
                      disabled: record.user_id === userInfo.user_id,
                    },
                  ],
                  onClick: ({ key }) => handleMoreCommand(key, record),
                }}
                trigger={["click"]}
              >
                <Button
                  type="link"
                  icon={<MoreOutlined />}
                  onClick={(e) => e.stopPropagation()}
                />
              </Dropdown>
            )}
          </div>
        ),
      },
    ],
    [t, userInfo.user_id, isWorkEnv, loadUserList],
  );

  // Initial load
  useEffect(() => {
    const init = async () => {
      await loadSubscriptionOptions();
      loadUserList();
    };
    init();
  }, []);

  // Reload when filters change
  useEffect(() => {
    if (subscriptionOptions.length > 0) {
      loadUserList();
    }
  }, [page, pageSize, groupId, rangeBy, dateRange, subscriptionOptions]);

  return (
    <div className="px-2 flex-1 flex flex-col bg-white">
      {/* Filters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Select
            value={groupId}
            onChange={(value) => setGroupId(value)}
            style={{ width: 180 }}
          >
            {subscriptionOptions.map((opt) => (
              <Select.Option key={opt.value} value={opt.value}>
                {opt.label}
              </Select.Option>
            ))}
          </Select>

          <Select
            value={rangeBy}
            onChange={(value) => setRangeBy(value)}
            style={{ width: 180 }}
          >
            {rangeOptions.map((opt) => (
              <Select.Option key={opt.value} value={opt.value}>
                {opt.label}
              </Select.Option>
            ))}
          </Select>

          <DateRangeFilter
            value={dateRange}
            onChange={setDateRange}
            valueFormat={(date: Date) => date.getTime()}
          />
        </div>

        <div className="flex gap-3">
          <Search
            mode="expanded"
            value={keyword}
            onDebouncedChange={(val) => {
              keywordRef.current = val;
              setKeyword(val);
              refresh();
            }}
            placeholder={t("module.operation_user_search_placeholder")}
            className="w-[268px]"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto bg-white rounded-lg mt-4">
        <Table
          rowKey="user_id"
          columns={columns}
          dataSource={tableData}
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total: tableTotal,
            showSizeChanger: true,
            showTotal: (total) => t("table_footer_text", { total }),
            onChange: (newPage, newPageSize) => {
              setPage(newPage);
              setPageSize(newPageSize);
            },
          }}
          rowClassName="group cursor-pointer hover:bg-gray-50"
          onRow={(record) => ({
            onClick: () => handleRowClick(record),
          })}
          scroll={{ x: "max-content" }}
        />
      </div>

      {/* User Add Dialog */}
      <UserAddDialog
        open={addDialogOpen}
        data={editingUser || undefined}
        subscriptionOptions={subscriptionOptions}
        onClose={() => {
          setAddDialogOpen(false);
          setEditingUser(null);
        }}
        onSuccess={() => {
          setAddDialogOpen(false);
          setEditingUser(null);
          loadUserList();
        }}
      />

      {/* Dialogue Record Drawer */}
      <DialogueRecordDrawer ref={dialogueRecordRef} />
    </div>
  );
}

export default UserRegisterList;
