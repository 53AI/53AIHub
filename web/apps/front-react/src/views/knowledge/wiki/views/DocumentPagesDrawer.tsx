import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Drawer, Empty, Pagination, Spin, Tag, Typography } from "antd";
import { getFormatTimeStamp } from "@km/shared-utils";
import wikiApi from "@/api/modules/wiki";
import type { WikiDocumentPagesResponse } from "@/api/modules/wiki";
import { t } from "@/locales";
import { buildWikiPageUrl } from "@/utils/router";

const PAGE_SIZE = 10;

type DocumentPagesDrawerProps = {
  spaceId: string;
  fileId: string;
  onClose: () => void;
  onRetry: (ids: string[]) => Promise<void> | void;
  retrying: boolean;
  refreshKey: number;
};

export function QueueStatus({ status }: { status: string }): React.ReactElement {
  const color = { failed: "error", success: "success", processing: "processing", pending: "warning" }[status];
  return <Tag color={color}>{t(`wiki.queue.filter_${status}`)}</Tag>;
}

function DocumentPagesContent({
  spaceId,
  fileId,
  onClose,
  onRetry,
  retrying,
  refreshKey,
}: DocumentPagesDrawerProps): React.ReactElement {
  const [data, setData] = useState<WikiDocumentPagesResponse>();
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const load = useCallback(
    async (quiet = false): Promise<void> => {
      const current = ++requestId.current;
      if (!quiet) setIsLoading(true);
      try {
        const result = await wikiApi.documentPages(fileId, { space_id: spaceId, page, size: PAGE_SIZE });
        if (current !== requestId.current) return;
        setData(result);
        setError("");
      } catch (failure) {
        if (current === requestId.current)
          setError(failure instanceof Error ? failure.message : t("wiki.queue.load_failed"));
      } finally {
        if (current === requestId.current) setIsLoading(false);
      }
    },
    [spaceId, fileId, page],
  );
  useEffect(() => {
    void refreshKey;
    void load();
    const timer = window.setInterval(() => {
      void load(true);
    }, 10000);
    return () => {
      ++requestId.current;
      window.clearInterval(timer);
    };
  }, [load, refreshKey]);
  const document = data?.document;
  const emptyKey =
    document?.generation_status === "failed" || document?.generation_status === "cancelled"
      ? "wiki.queue.generation_failed"
      : ["pending", "processing", "waiting"].includes(document?.generation_status || "")
        ? "wiki.queue.pages_generating"
        : "wiki.queue.pages_empty";
  return (
    <Drawer
      open
      placement="right"
      title={t("wiki.queue.related_pages")}
      onClose={onClose}
      size={640}
      rootClassName="wiki-document-pages-drawer"
      footer={data && data.total > PAGE_SIZE && (
        <div className="flex justify-end">
          <Pagination
            simple
            size="small"
            current={page}
            pageSize={PAGE_SIZE}
            total={data.total}
            showSizeChanger={false}
            onChange={setPage}
          />
        </div>
      )}
    >
      <Spin spinning={isLoading}>
        {error ? (
          <Alert
            type="error"
            title={error}
            action={
              <Button
                onClick={() => {
                  void load();
                }}
              >
                {t("action.retry")}
              </Button>
            }
          />
        ) : (
          <>
            {data && data.items.length === 0 && <Empty description={t(emptyKey)} />}
            <div className="divide-y divide-[var(--border-color)]">
              {data?.items.map((item) => (
                <div key={item.page_id} className="space-y-1.5 py-3 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Typography.Link
                        href={buildWikiPageUrl(spaceId, item.page_slug)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="!block min-w-0 flex-1 !text-sm !font-medium"
                      >
                        <Typography.Text ellipsis={{ tooltip: item.title }} className="!text-inherit">
                          {item.title}
                        </Typography.Text>
                      </Typography.Link>
                      <span className="shrink-0 text-sm text-secondary">
                        {t(`wiki.page_type.${item.page_type}`)}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-sm">
                      <Typography.Text className="text-secondary">
                        {t("wiki.queue.index_status")}
                      </Typography.Text>
                      <QueueStatus status={item.vectorization_status} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-secondary">
                      <span>
                        {t("wiki.queue.page_status")}: {t(`wiki.queue.page_${item.page_status}`)}
                      </span>
                      <span>{item.updated_time ? getFormatTimeStamp(item.updated_time) : "—"}</span>
                      <span>
                        {t("wiki.queue.column_retries")}: {item.retry_count}
                      </span>
                    </div>
                    {item.retry_eligible && item.vectorization_task_id && (
                      <Button
                        size="small"
                        disabled={retrying}
                        onClick={() => {
                          void onRetry([item.vectorization_task_id!]);
                        }}
                      >
                        {t("action.retry")}
                      </Button>
                    )}
                  </div>
                  {item.failure_summary && (
                    <Typography.Paragraph className="!mb-0 text-sm text-secondary">
                      {item.failure_summary}
                    </Typography.Paragraph>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Spin>
    </Drawer>
  );
}

export default function DocumentPagesDrawer(props: DocumentPagesDrawerProps): React.ReactElement {
  return <DocumentPagesContent key={`${props.spaceId}:${props.fileId}`} {...props} />;
}
