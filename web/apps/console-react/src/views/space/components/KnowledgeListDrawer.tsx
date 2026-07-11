import { Table, Button, message } from "antd";
import {
  forwardRef,
  useImperativeHandle,
  useState,
  useCallback,
  useMemo,
} from "react";
import type { ColumnsType } from "antd/es/table";
import { librariesApi } from "@/api/modules/libraries";
import type { LibraryDisplayItem } from "@/api/modules/libraries/types";
import type { SpaceItem } from "@/api/modules/spaces/types";
import { checkKMPermission } from "@/utils/km-permission";
import { PERMISSION_TYPE } from "@/constants/kmPermission";
import { useEnv } from "@/hooks/useEnv";
import { useEnterpriseStore } from "@/stores";
import { t } from "@/locales";
import { getPublicPath } from "@/utils/config";

export interface KnowledgeListDrawerRef {
  open: (data: SpaceItem) => void;
}

function KnowledgeListDrawerInner(
  _: {},
  ref: React.ForwardedRef<KnowledgeListDrawerRef>,
) {
  const { isOpLocalEnv, isPrivatePremEnv } = useEnv();
  const enterpriseStore = useEnterpriseStore();

  const [tableData, setTableData] = useState<LibraryDisplayItem[]>([]);
  const [displayedData, setDisplayedData] = useState<LibraryDisplayItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [spaceId, setSpaceId] = useState("");
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10 });

  const open = useCallback((data: SpaceItem) => {
    setSpaceId(data.id);
    setDisplayedData([]);
    setTotal(0);
    setPagination({ page: 1, pageSize: 10 });
    loadList(data.id);
  }, []);

  const loadList = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await librariesApi.list({
        space_id: id,
        offset: 0,
        limit: 999,
      });
      setTableData(res || []);
      setTotal(res?.length || 0);
      setDisplayedData((res || []).slice(0, 10));
    } catch (error) {
      console.error("Load library list error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useImperativeHandle(ref, () => ({ open }), [open]);

  const handlePageSizeChange = useCallback(
    (page: number, pageSize: number) => {
      setPagination({ page, pageSize });
      setDisplayedData(tableData.slice((page - 1) * pageSize, page * pageSize));
    },
    [tableData],
  );

  const handleManage = useCallback(
    (row: LibraryDisplayItem) => {
      const checkResult = checkKMPermission(
        row.permission,
        PERMISSION_TYPE.manage,
      );
      if (!checkResult.hasPermission) {
        message.error(checkResult.message);
        return;
      }
      const domainUrl =
        isOpLocalEnv || isPrivatePremEnv
          ? `${window.location.origin}`
          : enterpriseStore.info.domain;
      window.open(`${domainUrl}/library/${row.id}/setting/info`, "_blank");
    },
    [isOpLocalEnv, isPrivatePremEnv, enterpriseStore.info.domain],
  );

  const columns: ColumnsType<LibraryDisplayItem> = useMemo(
    () => [
      {
        title: t("common.name"),
        dataIndex: "name",
        key: "name",
        minWidth: 160,
        render: (_, record) => (
          <div className="flex items-center gap-2">
            <img
              src={record.icon}
              className="size-7 rounded"
              alt={record.name}
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = getPublicPath("/images/default_agent.png");
              }}
            />
            <span>{record.name}</span>
          </div>
        ),
      },
      {
        title: t("created_time"),
        dataIndex: "created_time",
        key: "created_time",
        minWidth: 140,
        render: (time: string) => (
          <span className={time ? "" : "text-disabled"}>{time || "--"}</span>
        ),
      },
      {
        title: t("common.creator"),
        key: "creator",
        minWidth: 120,
        render: (_, record) => (
          <div className="flex items-center gap-2">
            {record.icon ? (
              <img
                src={record.icon}
                className="size-7 rounded-full"
                alt="creator"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = getPublicPath("/images/default_avatar.png");
                }}
              />
            ) : (
              <div className="size-6 bg-[#E0EEFF] flex items-center justify-center rounded-full">
                <div className="text-xs text-brand">系</div>
              </div>
            )}
            <span>{(record as any).creator_name || "--"}</span>
          </div>
        ),
      },
      {
        title: t("operation"),
        key: "operation",
        width: 120,
        align: "right",
        render: (_, record) => (
          <Button type="link" onClick={() => handleManage(record)}>
            {t("action.manage")}
          </Button>
        ),
      },
    ],
    [t, handleManage],
  );

  return (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={displayedData}
      loading={loading}
      pagination={{
        current: pagination.page,
        pageSize: pagination.pageSize,
        total,
        showSizeChanger: true,
        showTotal: (total) => t("table_footer_text", { total }),
        onChange: handlePageSizeChange,
        onShowSizeChange: handlePageSizeChange,
      }}
      scroll={{ x: "max-content" }}
    />
  );
}

export const KnowledgeListDrawer = forwardRef<KnowledgeListDrawerRef>(
  KnowledgeListDrawerInner,
);

export default KnowledgeListDrawer;
