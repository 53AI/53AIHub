import { useState, useEffect, useMemo, useCallback } from "react";
import { Spin, Empty, Checkbox } from "antd";
import type { WikiPageItem } from "@/api/modules/wiki";
import { wikiApi } from "@/api/modules/wiki";
import { permissionsApi } from "@/api/modules/permissions";
import { RESOURCE_TYPE, PERMISSION_TYPE } from "@/components/KMPermission/constant";
import { getPublicPath } from "@/utils/config";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import type { WikiItem } from "../dialog";

export interface KnowledgeSearchProps {
  searchText: string;
  selectedWikis: WikiItem[];
  onTogglePage: (page: WikiPageItem) => void;
}

export function KnowledgeSearch({
  searchText,
  selectedWikis,
  onTogglePage,
}: KnowledgeSearchProps) {
  const [pageList, setPageList] = useState<WikiPageItem[]>([]);
  const [loading, setLoading] = useState(false);

  // 搜索并做权限过滤
  useEffect(() => {
    const kw = searchText.trim();
    if (!kw) {
      setPageList([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    wikiApi.search({ keyword: kw, limit: 100 }).then(async (data) => {
      if (cancelled) return;

      const allPages = data.items ?? [];

      let permissionMap: Record<string, number> = {};
      if (allPages.length > 0) {
        permissionMap = await permissionsApi.myBatch({
          resource_type: RESOURCE_TYPE.wiki_page,
          resource_ids: allPages.map((item: WikiPageItem) => item.id),
        });
      }

      if (cancelled) return;

      const filteredPages = allPages.filter((item: WikiPageItem) => {
        if (item.visibility !== 'private') return true;
        const key = `${RESOURCE_TYPE.wiki_page}:${item.id}`;
        return permissionMap[key] >= PERMISSION_TYPE.viewer;
      });

      setPageList(filteredPages);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [searchText]);

  const searchResults = useMemo(() => {
    return [...pageList].sort((a, b) =>
      a.title.localeCompare(b.title, "zh-Hans-CN", { sensitivity: "base" }),
    );
  }, [pageList]);

  // 判断单个是否选中
  const isPageSelected = useCallback(
    (page: WikiPageItem) => selectedWikis.some((w) => w.wikiType === 'page' && w.id === page.id),
    [selectedWikis],
  );

  return (
    <div className="h-[500px] overflow-y-auto border rounded-xl px-2 py-1">
      {loading && pageList.length === 0 ? (
        <div className="flex justify-center py-10">
          <Spin />
        </div>
      ) : searchResults.length === 0 ? (
        <Empty
          image={getPublicPath("/images/empty.png")}
          description={t("dynamic_knowledge.no_match_results")}
          className="py-20"
        />
      ) : (
        <div>
          <div className="h-9 px-2 flex items-center text-sm text-secondary">
            {t("dynamic_knowledge.label")} ({searchResults.length})
          </div>
          <div className="space-y-1">
            {searchResults.map((item) => {
              const isSelected = isPageSelected(item);
              return (
                <div
                  key={item.id}
                  onClick={() => onTogglePage(item)}
                  className={`h-9 flex items-center gap-2 px-2 rounded cursor-pointer ${
                    isSelected ? "hover:bg-[#EDF3FF]" : "hover:bg-[#F2F3F5]"
                  }`}
                >
                  <Checkbox checked={isSelected} />
                  <div className="size-5 rounded flex items-center justify-center bg-[#4798F5] text-white">
                    <SvgIcon name="doc-detail" size={14} />
                  </div>
                  <span className="flex-1 text-sm text-[#1D1E1F] truncate">{item.title}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
