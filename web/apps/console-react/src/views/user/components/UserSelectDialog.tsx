import { useState, useEffect, useMemo, useRef } from "react";
import { Modal, Table, Tabs, Button, message } from "antd";
import { t } from "@/locales";
import { Search } from "@km/shared-components-react";
import { useUserStore } from "@/stores";
import { userApi, USER_ROLE_ADMIN, USER_ROLE_CREATOR } from "@/api/modules/user";
import type { ColumnsType, TableProps } from "antd/es/table";

interface UserItem {
  user_id: number;
  username: string;
  nickname: string;
  mobile: string;
  email: string;
  register_time: string;
  role?: number;
}

interface UserSelectDialogProps {
  open: boolean;
  value?: UserItem[];
  onClose: () => void;
  onSuccess?: (result: { value: UserItem[] }) => void;
}

export default function UserSelectDialog({
  open,
  value = [],
  onClose,
  onSuccess,
}: UserSelectDialogProps) {
  const userStore = useUserStore();
  const [loading, setLoading] = useState(false);
  const [tabActiveName, setTabActiveName] = useState<"register" | "internal">("register");
  const [keyword, setKeyword] = useState("");
  const keywordRef = useRef(keyword);
  keywordRef.current = keyword;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [tableData, setTableData] = useState<UserItem[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [registerCheckedList, setRegisterCheckedList] = useState<UserItem[]>([]);
  const [internalCheckedList, setInternalCheckedList] = useState<UserItem[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // Combined checked list
  const checkedList = useMemo(() => {
    const list = [...registerCheckedList, ...internalCheckedList];
    return list.filter(
      (item) => ![USER_ROLE_ADMIN, USER_ROLE_CREATOR].includes(Number(item.role))
    );
  }, [registerCheckedList, internalCheckedList]);

  // Fetch user list
  const fetchUserList = async (params?: { page?: number; pageSize?: number }) => {
    const currentPage = params?.page ?? page;
    const currentPageSize = params?.pageSize ?? pageSize;
    setLoading(true);
    try {
      const reqParams = {
        keyword: keywordRef.current,
        offset: (currentPage - 1) * currentPageSize,
        limit: currentPageSize,
      };

      const isRegister = tabActiveName === "register";
      const res = isRegister
        ? await userStore.loadListData({ data: reqParams })
        : await userApi.fetch_internal_user(reqParams);

      const list = isRegister ? res.list : res.list || [];
      const total = isRegister ? res.total : res.total || 0;

      setTableData(list as UserItem[]);
      setTableTotal(total);
    } catch (error) {
      console.error("Fetch user list error:", error);
    } finally {
      setLoading(false);
    }
  };

  // Reset and fetch on open
  useEffect(() => {
    if (open) {
      setKeyword("");
      setRegisterCheckedList([]);
      setInternalCheckedList([]);
      setSelectedRowKeys([]);
      setTabActiveName("register");
      setPage(1);
      fetchUserList({ page: 1 });
    }
  }, [open]);

  // Fetch on tab change
  useEffect(() => {
    if (open) {
      setPage(1);
      fetchUserList({ page: 1 });
    }
  }, [tabActiveName]);

  // Refresh
  const handleRefresh = () => {
    setPage(1);
    fetchUserList({ page: 1 });
  };

  // Handle confirm
  const handleConfirm = () => {
    const selectedValue = JSON.parse(JSON.stringify(checkedList));
    onSuccess?.({ value: selectedValue });
    onClose();
  };

  // Table columns
  const columns: ColumnsType<UserItem> = [
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
  ];

  // Row selection
  const rowSelection: TableProps<UserItem>["rowSelection"] = {
    type: "checkbox",
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[], selectedRows: UserItem[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
      if (tabActiveName === "register") {
        setRegisterCheckedList(selectedRows);
      } else {
        setInternalCheckedList(selectedRows);
      }
    },
    getCheckboxProps: (record: UserItem) => ({
      disabled: [USER_ROLE_ADMIN, USER_ROLE_CREATOR].includes(Number(record.role)),
    }),
  };

  // Tab items
  const tabItems = [
    { key: "register", label: t("register_user.title") },
    { key: "internal", label: t("internal_user.title") },
  ];

  return (
    <Modal
      title={t("action_select")}
      open={open}
      onCancel={onClose}
      destroyOnHidden
      width={800}
      centered
      footer={
        <div className="flex items-center justify-between">
          <div
            className="text-sm text-gray-500"
            dangerouslySetInnerHTML={{
              __html: t("selected_tip", {
                total: `<span class='text-blue-500'>${checkedList.length}</span>`,
              }),
            }}
          />
          <div className="flex gap-2">
            <Button onClick={onClose}>{t("action_cancel")}</Button>
            <Button
              type="primary"
              disabled={checkedList.length === 0}
              onClick={handleConfirm}
            >
              {t("action_confirm")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex items-center justify-between">
        <Tabs
          activeKey={tabActiveName}
          items={tabItems}
          onChange={(key) => {
            setTabActiveName(key as "register" | "internal");
            setSelectedRowKeys([]);
          }}
          className="mb-0"
        />
        <Search
          mode="expanded"
          value={keyword}
          onDebouncedChange={(val) => {
            keywordRef.current = val;
            setKeyword(val);
            handleRefresh();
          }}
          placeholder={t("module.operation_user_search_placeholder")}
          className="w-[220px]"
        />
      </div>

      <Table
        className="mt-4"
        rowKey="user_id"
        columns={columns}
        dataSource={tableData}
        loading={loading}
        rowSelection={rowSelection}
        pagination={{
          current: page,
          pageSize,
          total: tableTotal,
          showSizeChanger: true,
          showTotal: (total) => t("table_footer_text", { total }),
          onChange: (newPage, newPageSize) => {
            setPage(newPage);
            setPageSize(newPageSize);
            fetchUserList({ page: newPage, pageSize: newPageSize });
          },
        }}
        size="small"
      />
    </Modal>
  );
}
