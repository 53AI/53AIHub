// packages/shared-business/src/chat/components/source/lists/Quotation.tsx

import { useState, useMemo } from 'react';
import { UpOutlined, RightOutlined, LinkOutlined } from '@ant-design/icons';
import { SvgIcon } from "@km/shared-components-react";
import { useTranslation, useChatConfig, buildLibraryUrl } from '../../../i18n';
import { SafeImage } from '@km/shared-components-react';
import type { ChunkItem } from '../../../types/message';
import RagPill from '../RagPill';

interface QuotationProps {
  type?: string;
  files?: ChunkItem[];
}

export function Quotation({ files = [] }: QuotationProps) {
  const { t } = useTranslation();
  const config = useChatConfig();
  const [showFiles, setShowFiles] = useState(false);

  const getIndex = (sourceKey?: string) => {
    const match = (sourceKey || '').replace('[Source:', '').replace(']', '').split('-');
    const index = match[0];
    return Number(index) > -1 ? index : '';
  };

  const fileList = useMemo(() => {
    const list = files.map(item => ({
      ...item,
      index: getIndex(item.source_key || item.source)
    }));
    return list.sort((a, b) => Number(a.index) - Number(b.index));
  }, [files]);

  // 分别统计：知识文档（排除 wiki 与联网搜索）vs 动态知识（wiki）
  const { docCount, wikiCount, webCount } = useMemo(() => {
    let docCount = 0;
    let wikiCount = 0;
    let webCount = 0;
    for (const item of fileList) {
      if (item.chunk_type === 'wiki') {
        wikiCount += 1;
      } else if (item.chunk_type === 'web_search' || item.chunk_type === 'web_page') {
        webCount += 1;
      } else {
        docCount += 1;
      }
    }
    return { docCount, wikiCount, webCount };
  }, [fileList]);

  const quotationText = useMemo(() => {
    if (webCount > 0) {
      const items = [
        docCount > 0 ? t("chat.quotation_doc_item", { count: docCount }) || `${docCount} 篇知识文档` : "",
        wikiCount > 0 ? t("chat.quotation_wiki_item", { count: wikiCount }) || `${wikiCount} 篇 Wiki` : "",
        t("chat.quotation_web_item", { count: webCount }) || `${webCount} 个网页`,
      ].filter(Boolean);
      return t("chat.quotation_summary", { items: items.join("、") }) || `引用了 ${items.join("、")}`;
    }
    if (docCount > 0 && wikiCount > 0) {
      return t("chat.quotation_mixed", { docCount, wikiCount })
        || `引用了 ${docCount} 篇知识文档、${wikiCount} 篇 Wiki`;
    }
    if (wikiCount > 0) {
      return t("chat.quotation_wiki", { count: wikiCount })
        || `引用了 ${wikiCount} 篇 Wiki`;
    }
    return t("chat.quotation_doc", { count: docCount })
      || `引用了 ${docCount} 篇知识文档`;
  }, [docCount, wikiCount, t]);

  if (!files.length) return null;

  const handleFileClick = (item: ChunkItem) => {
    // 使用配置构建 URL
    const url = buildLibraryUrl(config, item.library_id, item.file_id, item);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // 拼出 `/空间名/知识库名` 后缀；任一为空则跳过对应段
  const buildPathSuffix = (space_name?: string, library_name?: string): string => {
    const parts = [space_name, library_name].filter(
      (s) => typeof s === 'string' && s.trim().length > 0
    ) as string[];
    return parts.length > 0 ? `/${parts.join('/')}` : '';
  };

  return (
    <>
      <RagPill
        className="mt-3"
        onClick={() => setShowFiles(!showFiles)}
      >
        <p className="text-sm text-[#1D1E1F]">
          {quotationText}
        </p>
        {showFiles ? (
          <UpOutlined className="text-[#939499] ml-2" />
        ) : (
          <RightOutlined className="text-[#939499] ml-2" />
        )}
      </RagPill>
      {showFiles && (
        <div className="space-y-1.5 mt-3">
          {fileList.map((item, index) => {
            const displayIndex = item.index || index + 1;

            // 网页搜索来源：显示摘要并提供原文链接
            if (item.chunk_type === 'web_search' || item.chunk_type === 'web_page') {
              const sourceUrl = item.file_path || item.url || '';
              return (
                <div
                  key={item.chunk_id || item.file_id || index}
                  className="flex items-start gap-2"
                >
                  <div className="size-4 rounded-full bg-[#EDEDED] flex items-center justify-center text-xs text-[#4F5052]">
                    {displayIndex}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm text-[#1D1E1F]">
                      <LinkOutlined className="text-[#939499]" />
                      <span className="truncate">{item.file_name || '模型搜索摘要'}</span>
                    </div>
                    {sourceUrl && (
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-5 mt-1 block text-xs text-[#2563EB] truncate"
                      >
                        {sourceUrl}
                      </a>
                    )}
                  </div>
                </div>
              );
            }

            // 动态知识（wiki）：跳转到 wiki 页面 URL
            if (item.chunk_type === ('wiki' as const)) {
              const pathSuffix = buildPathSuffix(item?.space_name);
              return (
                <div
                  key={item.chunk_id || item.file_id || index}
                  onClick={() => handleFileClick(item)}
                  className="flex items-center gap-2 cursor-pointer hover:bg-[#F5F5F5] rounded px-1 py-0.5 -mx-1 group"
                >
                  <div className="size-4 rounded-full bg-[#EDEDED] flex items-center justify-center text-xs text-[#4F5052]">
                    {displayIndex}
                  </div>
                  <span className="size-5 rounded bg-[#EDF3FF] flex items-center justify-center text-[#2563EB]">
                    <SvgIcon name="doc-detail" size={12} />
                  </span>
                  <div className="flex-1 text-sm text-[#1D1E1F] truncate">
                    {item.file_name}
                    {pathSuffix && (
                      <span className="text-[#939499] ml-1 invisible group-hover:visible">{pathSuffix}</span>
                    )}
                  </div>
                </div>
              );
            }

            // 知识库类型：跳转到文档
            const pathSuffix = buildPathSuffix(item?.space_name, item?.library_name);
            return (
              <div
                key={item.chunk_id || item.file_id || index}
                className="flex items-center gap-2 cursor-pointer hover:bg-[#F5F5F5] rounded px-1 py-0.5 -mx-1 group"
                onClick={() => handleFileClick(item)}
              >
                <div className="size-4 rounded-full bg-[#EDEDED] flex items-center justify-center text-xs text-[#4F5052]">
                  {displayIndex}
                </div>
                {item.file_icon && <SafeImage src={item.file_icon} className="size-5" alt="" />}
                <div className="flex-1 text-sm text-[#1D1E1F] truncate">
                  {item.file_name}
                  {pathSuffix && (
                    <span className="text-[#939499] ml-1 invisible group-hover:visible">{pathSuffix}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default Quotation;
