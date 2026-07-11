import { useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { Drawer, Button, Table, message, Modal } from "antd";
import { SvgIcon, Search } from "@km/shared-components-react";
import { t } from "@/locales";
import { providerApi } from "@/api/modules/provider";
import { PROVIDER_VALUES } from "@/constants/platform/config";
import { ProviderAuthorizeDialog } from "./ProviderAuthorizeDialog";

interface AgentData {
  agent_id?: number;
  name?: string;
  description?: string;
  logo?: string;
  enable?: boolean;
  sort?: number;
  user_group_ids: number[];
  user_group_names: string[];
  channel_config?: {
    channel_type?: string;
  };
  provider_id?: number;
  base_url?: string;
  configs?: {
    client_id?: string;
    secret_id?: string;
  };
  created_time?: string;
  provider_type?: number;
}

interface AuthListDrawerProps {
  onChange?: () => void;
}

export interface AuthListDrawerRef {
  open: (options?: { data?: Record<string, any>; type?: number }) => void;
  close: () => void;
}

export const AuthListDrawer = forwardRef<
  AuthListDrawerRef,
  AuthListDrawerProps
>(({ onChange }, ref) => {
  const [visible, setVisible] = useState(false);
  const [filterForm, setFilterForm] = useState({
    name: "",
  });
  const [tableData, setTableData] = useState<AgentData[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const [originData, setOriginData] = useState<Record<string, any>>({});
  const [authorizeOpen, setAuthorizeOpen] = useState(false);
  const [editingData, setEditingData] = useState<AgentData | null>(null);

  const loadList = useCallback(async (params?: { name?: string; providerType?: number }) => {
    setTableLoading(true);
    try {
      const type = params?.providerType ?? originData.provider_type;
      const searchName = params?.name ?? filterForm.name;
      const res = await providerApi.list({
        params: { name: searchName, providerType: type },
      });
      setTableData(res);
      setTableTotal(res.length);
    } finally {
      setTableLoading(false);
    }
  }, [filterForm, originData.provider_type]);

  const refresh = useCallback(() => {
    return loadList();
  }, [loadList]);

  const open = useCallback(
    async (options: { data?: Record<string, any>; type?: number } = {}) => {
      const { data = {}, type = PROVIDER_VALUES.DIFY } = options;
      setFilterForm({ name: "" });
      setOriginData(data);
      setTableData([]);
      setVisible(true);
      loadList({ providerType: data.provider_type, name: "" });
    },
    [loadList],
  );

  const close = useCallback(() => {
    setVisible(false);
  }, []);

  const handleAddProvider = useCallback(() => {
    setEditingData(originData as AgentData);
    setAuthorizeOpen(true);
  }, [originData]);

  const handleEditProvider = useCallback((data: AgentData) => {
    setEditingData(data);
    setAuthorizeOpen(true);
  }, []);

  const handleDeleteProvider = useCallback(
    async (data: AgentData) => {
      Modal.confirm({
        title: t("action_delete"),
        content: t("module.platform_delete_confirm"),
        okText: t("action_confirm"),
        cancelText: t("action_cancel"),
        onOk: async () => {
          await providerApi.delete({
            data: { provider_id: data.provider_id! },
          });
          message.success(t("action_delete_success"));
          loadList();
          onChange?.();
        },
      });
    },
    [loadList, onChange],
  );

  const onRowClick = useCallback(
    (row: AgentData) => {
      handleEditProvider(row);
    },
    [handleEditProvider],
  );

  const onSuccess = useCallback(() => {
    loadList();
    onChange?.();
  }, [loadList, onChange]);

  useImperativeHandle(
    ref,
    () => ({
      open,
      close,
    }),
    [open, close],
  );

  const columns = [
    {
      title: t("module.website_info_name"),
      dataIndex: "name",
      key: "name",
      width: 100,
      ellipsis: true,
    },
    {
      title: t("module.platform_tool_api_endpoint"),
      dataIndex: "base_url",
      key: "base_url",
      width: 180,
      ellipsis: true,
      hidden: ![PROVIDER_VALUES["53AI"], PROVIDER_VALUES.COZE_OSV].includes(
        originData.provider_type,
      ),
    },
    {
      title: t("module.platform_auth_client_id"),
      dataIndex: ["configs", "client_id"],
      key: "client_id",
      width: 180,
      ellipsis: true,
      hidden: originData.provider_type !== PROVIDER_VALUES.COZE_CN,
    },
    {
      title: t("module.platform_auth_secret_id"),
      dataIndex: ["configs", "secret_id"],
      key: "secret_id",
      width: 180,
      ellipsis: true,
      hidden: originData.provider_type !== PROVIDER_VALUES.TENCENT,
    },
    {
      title: t("add_time"),
      dataIndex: "created_time",
      key: "created_time",
      width: 180,
      ellipsis: true,
    },
    {
      title: t("operation"),
      key: "operation",
      width: 120,
      align: "right" as const,
      fixed: "end" as const,
      render: (_: any, row: AgentData) => (
        <div className="flex gap-2 opacity-0 group-hover:opacity-100">
          <Button
            type="link"
            icon={<SvgIcon name="edit" />}
            className="hover:!text-brand"
            onClick={(e) => {
              e.stopPropagation();
              handleEditProvider(row);
            }}
          />
          <Button
            type="link"
            icon={<SvgIcon name="delete" />}
            className="hover:!text-tag-red"
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteProvider(row);
            }}
          />
        </div>
      ),
    },
  ].filter((col) => !(col as any).hidden);

  return (
    <>
      <Drawer
        open={visible}
        title={t(originData.label || "")}
        onClose={close}
        destroyOnHidden
        mask={{ closable: false }}
        styles={{ wrapper: { width: '70%' } }}
      >
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <Search
              mode="expanded"
              placeholder={t("action_search")}
              value={filterForm.name}
              onDebouncedChange={(val) => {
                setFilterForm({ name: val });
                loadList({ name: val });
              }}
            />
          </div>
          <Button type="primary" onClick={handleAddProvider}>
            {t("action_add")}
          </Button>
        </div>

        <Table
          rowKey="provider_id"
          columns={columns}
          dataSource={tableData}
          loading={tableLoading}
          className="platform-table"
          pagination={false}
          scroll={{ x: "max-content" }}
          onRow={(row) => ({
            onClick: () => onRowClick(row),
            className: "group cursor-pointer",
          })}
          headerRowClassName="rounded overflow-hidden"
        />
      </Drawer>

      <ProviderAuthorizeDialog
        open={authorizeOpen}
        data={{
          ...editingData,
          provider: editingData?.provider_type,
          channel_type: editingData?.provider_type,
          label: originData.label,
        }}
        onClose={() => setAuthorizeOpen(false)}
        onSuccess={onSuccess}
      />
    </>
  );
});

export default AuthListDrawer;
