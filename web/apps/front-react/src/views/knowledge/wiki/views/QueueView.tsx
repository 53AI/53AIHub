import { useCallback, useEffect, useMemo, useRef, useState, type Key } from "react";
import { Alert, Button, Checkbox, Empty, message, Pagination, Spin, Table, Typography } from "antd";
import { RedoOutlined } from "@ant-design/icons";
import type { TableColumnsType } from "antd";
import { Search, SvgIcon, Tabs } from "@km/shared-components-react";
import { getFormatTimeStamp } from "@km/shared-utils";
import { t } from "@/locales";
import { useResponsive } from "@/hooks/useResponsive";
import { useSpaceStore } from "@/stores/modules/space";
import wikiApi from "@/api/modules/wiki";
import type { WikiDocumentQueueItem, WikiDocumentStatus } from "@/api/modules/wiki";
import DocumentPagesDrawer from "./DocumentPagesDrawer";

type QueueFilter = "all" | WikiDocumentStatus;
const PAGE_SIZE = 10;
const EMPTY_COUNTS = { failed: 0, pending: 0, processing: 0, success: 0, waiting: 0 };

function QueueContent({ spaceId }: { spaceId: string }): React.ReactElement {
  const { isMobile } = useResponsive();
  const [items, setItems] = useState<WikiDocumentQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState("");
  const [selectedDocument, setSelectedDocument] = useState<WikiDocumentQueueItem>();
  const [refreshKey, setRefreshKey] = useState(0);
  const requestId = useRef(0);
  const isActive = useRef(true);
  const retryLock = useRef(false);
  useEffect(() => {
    isActive.current = true;
    return () => {
      isActive.current = false;
      ++requestId.current;
    };
  }, []);
  const load = useCallback(
    async (quiet = false): Promise<void> => {
      if (!spaceId) return;
      const current = ++requestId.current;
      if (!quiet) setIsLoading(true);
      try {
        const result = await wikiApi.queueDocuments({
          space_id: spaceId,
          status: filter === "all" ? undefined : filter,
          keyword: keyword || undefined,
          page,
          size: PAGE_SIZE,
        });
        if (!isActive.current || current !== requestId.current) return;
        setItems(result.items);
        setTotal(result.total);
        setCounts(result.status_counts);
        setError("");
        const eligible = new Set(result.items.filter((item) => item.retry_eligible).map((item) => item.file_id));
        setSelectedKeys((keys) => keys.filter((key) => eligible.has(String(key))));
      } catch (failure) {
        if (isActive.current && current === requestId.current)
          setError(failure instanceof Error ? failure.message : t("wiki.queue.load_failed"));
      } finally {
        if (isActive.current && current === requestId.current) setIsLoading(false);
      }
    },
    [spaceId, filter, keyword, page],
  );
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load(true);
    }, 10000);
    return () => {
      ++requestId.current;
      window.clearInterval(timer);
    };
  }, [load]);
  const retryTasks = async (taskIds: string[]): Promise<void> => {
    const ids = [...new Set(taskIds)];
    if (!ids.length || retryLock.current) return;
    retryLock.current = true;
    setIsRetrying(true);
    let successCount = 0;
    let failedCount = 0;
    try {
      for (let start = 0; start < ids.length; start += 100) {
        if (!isActive.current) return;
        try {
          const result = await wikiApi.retryQueueTasks(ids.slice(start, start + 100), spaceId);
          if (!isActive.current) return;
          for (const item of result.results) {
            if (item.success) successCount += 1;
            else failedCount += 1;
          }
        } catch (failure) {
          if (!isActive.current) return;
          message.error(failure instanceof Error ? failure.message : t("wiki.queue.retry_failed"));
        }
      }
      if (!isActive.current) return;
      if (successCount) message.success(t("wiki.queue.retry_success", { count: successCount }));
      if (failedCount) message.error(t("wiki.queue.retry_partial_failed", { count: failedCount }));
    } finally {
      retryLock.current = false;
      if (isActive.current) {
        setIsRetrying(false);
        setSelectedKeys([]);
        setRefreshKey((key) => key + 1);
        await latestLoad.current(true);
      }
    }
  };
  const selectedDocuments = useMemo(
    () => items.filter((item) => selectedKeys.includes(item.file_id) && item.retry_eligible),
    [items, selectedKeys],
  );
  const allCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const statuses: QueueFilter[] = ["all", "success", "pending", "processing", "failed", "waiting"];
  const title = (item: WikiDocumentQueueItem): React.ReactElement => (
    <Button type="link" className="!block !h-auto !px-0 max-w-full font-medium" onClick={() => setSelectedDocument(item)}>
      <Typography.Text ellipsis={{ tooltip: item.title }}>{item.title}</Typography.Text>
    </Button>
  );
  const retry = (item: WikiDocumentQueueItem): React.ReactElement => (
    <Button
      type="link"
      size="small"
      icon={<RedoOutlined />}
      loading={isRetrying}
      disabled={!item.retry_eligible || isRetrying}
      onClick={() => {
        void retryTasks(item.retry_task_ids);
      }}
    >
      {t("action.retry")}
    </Button>
  );
  const columns: TableColumnsType<WikiDocumentQueueItem> = [
    { title: t("wiki.queue.column_document"), key: "title", width: 220, render: (_, item) => title(item) },
    { title: t("wiki.queue.column_library"), dataIndex: "library_name", key: "library", width: 150 },
    {
      title: t("wiki.queue.document_status"),
      key: "status",
      width: 110,
      render: (_, item) => <QueueStatus status={item.status} />,
    },
    {
      title: t("wiki.queue.column_failure"),
      dataIndex: "failure_summary",
      key: "failure",
      width: 200,
      render: (value: string) => <Typography.Text ellipsis={{ tooltip: value }}>{value || "—"}</Typography.Text>,
    },
    {
      title: t("wiki.queue.column_time"),
      key: "time",
      width: 160,
      render: (_, item) => (item.updated_time ? getFormatTimeStamp(item.updated_time) : "—"),
    },
    {
      title: t("wiki.queue.column_action"),
      key: "action",
      fixed: "right",
      width: 100,
      render: (_, item) => retry(item),
    },
  ];
  const tabs = statuses.map(key => ({key, label: t(`wiki.queue.filter_${key}`), count: key === "all" ? allCount : counts[key]}));
  return (
    <div className="h-full overflow-y-auto bg-[#F8FAFD] px-8 py-6 max-md:px-4">
      <div className="flex items-center justify-between mb-2">
        <h1 className="m-0 text-2xl font-medium text-main">{t("wiki.queue.title")}</h1>
      </div>

      <h2 className="mt-4 mb-6 text-base font-medium text-[#1D1E1F]">{t("wiki.queue.stats_title")}</h2>
      <div className="mb-8 grid grid-cols-2 gap-6 max-md:mb-5 max-md:gap-3 md:grid-cols-3 xl:grid-cols-5">
        <QueueSummary
          label={t("wiki.queue.summary_all")}
          value={allCount}
          icon="file-collection"
          tone="all"
        />
        <QueueSummary
          label={t("wiki.queue.summary_success")}
          value={counts.success}
          icon="doc-success"
          tone="success"
        />
        <QueueSummary
          label={t("wiki.queue.summary_failed")}
          value={counts.failed}
          icon="file-failed"
          tone="danger"
        />
        <QueueSummary
          label={t("wiki.queue.summary_pending")}
          value={counts.pending + counts.waiting}
          icon="list-numbers"
          tone="pending"
        />
        <QueueSummary
          label={t("wiki.queue.summary_processing")}
          value={counts.processing}
          icon="time"
          tone="processing"
        />
      </div>

      <h3 className="mb-6 text-base font-medium text-[#1D1E1F]">{t("wiki.queue.list_title")}</h3>

      <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white px-5 pt-6 shadow-sm max-md:px-3">
        <div className="mb-6 flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
          <Tabs
            variant="segmented"
            className="max-md:w-full"
            items={tabs.map((tab) => ({
              key: tab.key,
              label: (
                <span className="flex items-center gap-1.5">
                  {tab.label}
                  <span className="text-xs text-secondary">{tab.count}</span>
                </span>
              ),
            }))}
            activeKey={filter}
            onChange={(key) => {
              setFilter(key as QueueFilter);
              setPage(1);
              setSelectedKeys([]);
            }}
          />
          <Search
            mode="expanded"
            className="w-[260px] max-sm:w-full"
            placeholder={t("wiki.queue.search_placeholder")}
            onDebouncedChange={(value) => {
              setKeyword(value.trim());
              setPage(1);
              setSelectedKeys([]);
            }}
          />
        </div>

        <div className="mb-3 flex min-h-8 items-center justify-between gap-2">
          <span className="text-sm text-secondary">
            {selectedDocuments.length > 0
              ? t("wiki.queue.selected_count", { count: selectedDocuments.length })
              : t("wiki.queue.result_count", { count: total })}
          </span>
          {selectedDocuments.length > 0 && (
            <Button
              type="primary"
              icon={<RedoOutlined />}
              loading={isRetrying}
              onClick={() => retryTasks(selectedDocuments.flatMap(item => item.retry_task_ids))}
            >
              {t("wiki.queue.retry_selected", { count: selectedDocuments.length })}
            </Button>
          )}
        </div>

        {error && <Alert className="mb-4" type="error" title={error} action={<Button onClick={() => {void load();}}>{t("action.retry")}</Button>} />}
        <Spin spinning={isLoading}>
          {isMobile ? (
            <>
              <div className="flex flex-col divide-y divide-[#f1f5f9] rounded-lg border border-gray-200 bg-white px-4">
              {items.map((item) => (
                <div key={item.file_id} className="flex items-start gap-3 py-3">
                  <Checkbox
                    checked={selectedKeys.includes(item.file_id)}
                    disabled={!item.retry_eligible || isRetrying}
                    className="mt-1 flex-none"
                    onChange={(event) =>
                      setSelectedKeys((keys) =>
                        event.target.checked
                          ? [...keys, item.file_id]
                          : keys.filter((key) => key !== item.file_id),
                      )
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <Button type="link" className="!block !h-auto !max-w-full !p-0 text-sm" onClick={() => setSelectedDocument(item)}>
                      <Typography.Text ellipsis={{ tooltip: item.title || "—" }} className="!block">
                        {item.title || "—"}
                      </Typography.Text>
                    </Button>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <QueueStatus status={item.status} />
                      <span className="text-xs text-secondary">
                        {item.library_name}
                      </span>
                    </div>
                    {item.status === "failed" && (
                      <Typography.Text
                        ellipsis={{ tooltip: item.failure_summary || t("wiki.queue.failure_unknown") }}
                        className="!mt-2 !block text-xs text-secondary"
                      >
                        {item.failure_summary || t("wiki.queue.failure_unknown")}
                      </Typography.Text>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-secondary">
                      <span>{item.updated_time ? getFormatTimeStamp(item.updated_time) : "—"}</span>
                    </div>
                  </div>
                  <Button
                    type="link"
                    size="small"
                    icon={<RedoOutlined />}
                    disabled={!item.retry_eligible || isRetrying}
                    loading={isRetrying}
                    onClick={() => retryTasks(item.retry_task_ids)}
                  >
                    {t("action.retry")}
                  </Button>
                </div>
              ))}
              {items.length === 0 && (
                <div className="py-12 text-center text-sm text-secondary">
                  {t("wiki.queue.empty")}
                </div>
              )}
              </div>
              <div className="flex justify-center py-4">
                <Pagination
                  total={total}
                  current={page}
                  pageSize={PAGE_SIZE}
                  simple
                  showSizeChanger={false}
                  onChange={(nextPage) => {
                    setPage(nextPage);
                    setSelectedKeys([]);
                  }}
                />
              </div>
            </>
          ) : (
            <Table<WikiDocumentQueueItem>
              rowKey="file_id"
              columns={columns}
              dataSource={items}
              rowSelection={{
                selectedRowKeys: selectedKeys,
                onChange: setSelectedKeys,
                getCheckboxProps: (item) => ({ disabled: !item.retry_eligible || isRetrying }),
              }}
              locale={{
                emptyText: (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("wiki.queue.empty")} />
                ),
              }}
              scroll={{ x: 900 }}
              className="custom-table"
              onRow={() => ({ className: "group transition-colors hover:bg-[#f8fafc]" })}
              pagination={{
                current: page,
                pageSize: PAGE_SIZE,
                total,
                showSizeChanger: false,
                showTotal: (count) => t("wiki.queue.result_count", { count }),
                onChange: (nextPage) => {
                  setPage(nextPage);
                  setSelectedKeys([]);
                },
                className: "!mt-4",
              }}
            />
          )}
        </Spin>
      </div>
      {selectedDocument && <DocumentPagesDrawer spaceId={spaceId} fileId={selectedDocument.file_id} onClose={() => setSelectedDocument(undefined)} onRetry={retryTasks} retrying={isRetrying} refreshKey={refreshKey} />}
    </div>
  );
}

const QueueSummary: React.FC<{
  label: string;
  value: number;
  icon?: "file-collection" | "file-failed" | "list-numbers" | "time" | "doc-success";
  tone: "all" | "danger" | "pending" | "processing" | "success";
}> = ({ label, value, icon = "file-failed", tone }) => {
  const iconClasses = {
    all: "flex size-12 flex-none items-center justify-center rounded-xl bg-[#f6f2ff] text-xl text-[#7948EA] max-md:size-10",
    danger: "flex size-12 flex-none items-center justify-center rounded-xl bg-[#fff1f2] text-xl text-[#f43f5e] max-md:size-10",
    pending: "flex size-12 flex-none items-center justify-center rounded-xl bg-[#eff6ff] text-xl text-[#3b82f6] max-md:size-10",
    processing: "flex size-12 flex-none items-center justify-center rounded-xl bg-[#fff7ed] text-xl text-[#f97316] max-md:size-10",
    success: "flex size-12 flex-none items-center justify-center rounded-xl bg-green-50 text-xl text-[var(--success-color)] max-md:size-10",
  }[tone];
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-6 max-md:gap-2 max-md:px-3 max-md:py-4">
      <div className={iconClasses}>
        <SvgIcon name={icon} size={24} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-sm font-medium text-[#999999]">{label}</p>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-[#1D1E1F] max-md:text-xl">{value}</span>
          <span className="text-sm text-[#1D1E1F]">个</span>
        </div>
      </div>
    </div>
  );
};

const QueueStatus: React.FC<{ status: WikiDocumentStatus }> = ({ status }) => {
  const statuses: Record<WikiDocumentStatus, {className: string; label: string}> = {
    failed: {
      className: "inline-flex whitespace-nowrap rounded bg-[#FFF1F2] px-2 py-1.5 text-sm text-[#f43f5e]",
      label: t("wiki.queue.filter_failed"),
    },
    pending: {
      className: "inline-flex whitespace-nowrap rounded bg-[#FFFBEB] px-2 py-1.5 text-sm text-[#f59e0b]",
      label: t("wiki.queue.filter_pending"),
    },
    processing: {
      className: "inline-flex whitespace-nowrap rounded bg-[#EFF6FF] px-2 py-1.5 text-sm text-blue-500",
      label: t("wiki.queue.filter_processing"),
    },
    waiting: {
      className: "inline-flex whitespace-nowrap rounded bg-[#FFFBEB] px-2 py-1.5 text-sm text-[#f59e0b]",
      label: t("wiki.queue.filter_waiting"),
    },
    success: {
      className: "inline-flex whitespace-nowrap rounded bg-green-50 px-2 py-1.5 text-sm text-[var(--success-color)]",
      label: t("wiki.queue.filter_success"),
    },
  };
  const props = statuses[status];
  return <span className={props.className}>{props.label}</span>;
};

export default function QueueView(): React.ReactElement {
  const spaceId = useSpaceStore((state) => state.spaceId);
  return <QueueContent key={spaceId} spaceId={spaceId} />;
}
