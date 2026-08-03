import {
  useState,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useRef,
  useMemo,
} from "react";
import { Drawer, Spin, Button } from "antd";
import { ExportOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import wikiApi from "@/api/modules/wiki";
import type { WikiPageDetail } from "@/api/modules/wiki/types";
import { markdownPreview } from "@/components/Markdown/helper";
import {
  transformWikiInlineMarkup,
  buildFileIdToSourceMetaResolver,
} from "@/views/knowledge/wiki/utils/wiki-markup";
import { buildWikiPageUrl } from "@/utils/router";

interface WikiViewDrawerProps {
  onClose?: () => void;
}

export interface WikiViewDrawerRef {
  open: (data: { space_id: string; slug: string }) => void;
  close: () => void;
}

export const KnowledgeWikiDrawer = forwardRef<WikiViewDrawerRef, WikiViewDrawerProps>(
  ({ onClose }, ref) => {
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const [detail, setDetail] = useState<WikiPageDetail | null>(null);
    const [currentSpaceId, setCurrentSpaceId] = useState<string>("");
    const requestIdRef = useRef(0);
    const contentRef = useRef<HTMLDivElement>(null);

    const loadPage = useCallback(async (space_id: string, slug: string, requestId: number) => {
      const res = await wikiApi.page(space_id, slug);
      if (requestId !== requestIdRef.current) return;
      setDetail(res);
      setCurrentSpaceId(space_id);
    }, []);

    const handleClose = useCallback(() => {
      requestIdRef.current += 1;
      setDetail(null);
      setCurrentSpaceId("");
      setVisible(false);
      onClose?.();
    }, [onClose]);

    const open = useCallback(async (data: { space_id: string; slug: string }) => {
      const requestId = ++requestIdRef.current;
      setDetail(null);
      setLoading(true);
      setVisible(true);
      try {
        await loadPage(data.space_id, data.slug, requestId);
      } catch {
        // 失败时清空数据，loading 关闭以显示空态
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }, [loadPage]);

    useImperativeHandle(ref, () => ({
      open,
      close: handleClose,
    }));

    const page = detail?.page;

    // 构造 wiki 页面 URL：抽屉里点击 wiki 内链要跳到 `/knowledge?...`
    // 用 buildUrl 生成完整 URL，自动适配 hash/history 路由
    const hrefBuilder = useCallback(
      (slug: string) =>
        buildWikiPageUrl(currentSpaceId, slug),
      [currentSpaceId],
    );

    // 头部按钮：点击在新标签页打开对应的动态知识页面
    const handleViewWiki = useCallback(() => {
      if (!page?.slug) return;
      window.open(
        buildWikiPageUrl(currentSpaceId, page.slug),
        "_blank",
        "noopener,noreferrer",
      );
    }, [page?.slug, currentSpaceId]);

    // 与 ViewMode.tsx 一致：wiki 内链 + 来源引用 转 markdown 链接
    const transformedBody = useMemo(() => {
      if (!page?.body) return "";
      const fileIdResolver = buildFileIdToSourceMetaResolver(page.sources);
      return transformWikiInlineMarkup(page.body, hrefBuilder, fileIdResolver);
    }, [page?.body, page?.sources, hrefBuilder]);

    // markdown 渲染：抽屉可见 + 正文变化时触发
    useEffect(() => {
      if (!visible || !contentRef.current) return;
      if (!transformedBody) {
        contentRef.current.innerHTML = "";
        return;
      }
      contentRef.current.innerHTML = "";
      markdownPreview(contentRef.current, transformedBody, {
        after: () => {
          // wiki 内链统一在新标签页打开，避免在抽屉内导航导致体验割裂
          const links = contentRef.current?.querySelectorAll("a");
          links?.forEach((a) => {
            a.setAttribute("target", "_blank");
            a.setAttribute("rel", "noopener noreferrer");
          });
        },
      });
    }, [visible, transformedBody]);

    // 抽屉关闭时清理渲染残留
    useEffect(() => {
      if (!visible && contentRef.current) {
        contentRef.current.innerHTML = "";
      }
    }, [visible]);

    return (
      <Drawer
        open={visible}
        onClose={handleClose}
        placement="left"
        styles={{
          wrapper: { width: "calc(100vw - 418px)", "--ant-box-shadow-drawer-left": "none", "--ant-motion-duration-slow": "none" },
          header: { padding: "16px 24px" },
          body: { padding: 0 },
        }}
        mask={false}
        destroyOnHidden
        title={
          <div className="flex items-center gap-2">
            <div className="size-6 flex-shrink-0 rounded bg-[#EDF3FF] flex items-center justify-center text-[#2563EB]">
              <SvgIcon name="doc-detail" size={16} />
            </div>
            <div className="flex-1 text-base text-[#1D1E1F] truncate">
              {page?.title || "--"}
            </div>
            {page?.slug && (
              <Button type="link" onClick={handleViewWiki}>
                查看动态知识
                <ExportOutlined className="ml-1.5" />
              </Button>
            )}
          </div>
        }
      >
        <Spin
          spinning={loading}
          classNames={{ root: "h-full", container: "h-full" }}
        >
          <div className="h-full overflow-auto">
            <div className="max-w-4xl mx-auto px-8 py-6">
              {page ? (
                <div ref={contentRef} className="vditor-reset wiki-markdown-body" />
              ) : !loading ? (
                <div className="text-sm text-[#999999]">暂无内容</div>
              ) : null}
            </div>
          </div>
        </Spin>
      </Drawer>
    );
  },
);

KnowledgeWikiDrawer.displayName = "KnowledgeWikiDrawer";

export default KnowledgeWikiDrawer;