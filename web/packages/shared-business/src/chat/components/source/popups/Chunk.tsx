// packages/shared-business/src/chat/components/source/popups/Chunk.tsx

import { forwardRef, useImperativeHandle, useState, useRef, useEffect, useCallback } from 'react';
import { Popover, Button, Spin } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { SvgIcon } from "@km/shared-components-react";
import { useTranslation, useChatConfig, buildLibraryUrl } from '../../../i18n';
import type { ChunkItem } from '../../../types/message';

export interface ChunkRef {
  setLibraryInfo: (chunk: ChunkItem | null, type?: string) => void;
  hide: () => void;
}

export interface ChunkProps {
  /** 虚拟 ref 元素（用于定位弹出位置） */
  virtualRef?: React.RefObject<HTMLElement | null>;
  /** 打开文档回调 */
  onOpenLibrary?: (chunk: ChunkItem) => void;
  /** 获取 chunk 详情回调（用于从 API 获取完整内容） */
  fetchChunkDetail?: (chunkId: string) => Promise<{ content: string; token_count?: number; chunk_index?: number }>;
  /** 获取 wiki 页面详情回调（用于动态知识：/api/spaces/{space_id}/wiki/pages/{slug}） */
  fetchWikiPageDetail?: (chunk: ChunkItem) => Promise<{ content: string; token_count?: number; chunk_index?: number }>;
  /** Markdown 渲染回调 */
  renderMarkdown?: (element: HTMLDivElement, content: string) => Promise<void>;
} 

const DEFAULT_WIDTH = 600;

function deepCopy<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

interface ChunkInfo extends ChunkItem {
  token_count?: number;
  chunk_index?: number;
  library_icon?: string;
  space_name?: string;
  title?: string
  page_type?: string
  version_no?: number
}

const Chunk = forwardRef<ChunkRef, ChunkProps>(
  ({ virtualRef, onOpenLibrary, fetchChunkDetail, fetchWikiPageDetail, renderMarkdown }, ref) => {
    const { t } = useTranslation();
    const config = useChatConfig();
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const [chunk, setChunk] = useState<ChunkInfo | null>(null);
    const [searchType, setSearchType] = useState<string>('web_search');
    const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    const isRagSearch = searchType !== 'web_search';

    // 缓存
    const cacheRef = useRef<Map<string, { content: string; token_count?: number; chunk_index?: number }>>(new Map());

    useImperativeHandle(ref, () => ({
      setLibraryInfo: (newChunk: ChunkItem | null, type?: string) => {
        if (!newChunk) {
          setVisible(false);
          setChunk(null);
          setTriggerRect(null);
          return;
        }
        setSearchType(type || 'web_search');
        const copied = deepCopy(newChunk);
        setChunk({
          ...copied,
          token_count: 0,
          chunk_index: 0,
        });
        setLoading(false);

        // 设置触发元素的位置
        if (virtualRef?.current) {
          setTriggerRect(virtualRef.current.getBoundingClientRect());
        }

        // web_search 类型直接显示，其他类型从 API 获取详情
        if (type === 'web_search') {
          setVisible(true);
          return;
        }

        const isWiki = newChunk.chunk_type === ('wiki' as const);

        // 动态知识（wiki）：通过 /api/spaces/{space_id}/wiki/pages/{slug} 拿正文
        if (isWiki && fetchWikiPageDetail) {
          const cacheKey = `wiki:${newChunk.wiki_page_id || newChunk.chunk_id}`;
          if (cacheKey) {
            const cached = cacheRef.current.get(cacheKey);
            if (cached) {
              setChunk(prev => prev ? { ...prev, ...cached } : null);
              setVisible(true);
            } else {
              setLoading(true);
              fetchWikiPageDetail(newChunk)
                .then(detail => {
                  cacheRef.current.set(cacheKey, detail);
                  setChunk(prev => prev ? { ...prev, ...detail } : null);
                })
                .catch(() => {
                  // 获取失败时使用已有数据
                })
                .finally(() => {
                  setLoading(false);
                });
              setVisible(true);
            }
            return;
          }
        }

        // 普通 RAG：有 fetchChunkDetail 回调且有 chunk_id 时，从 API 获取详情
        if (fetchChunkDetail && newChunk.chunk_id) {
          const cached = cacheRef.current.get(newChunk.chunk_id);
          if (cached) {
            setChunk(prev => prev ? { ...prev, ...cached } : null);
            setVisible(true);
          } else {
            setLoading(true);
            fetchChunkDetail(newChunk.chunk_id!)
              .then(detail => {
                cacheRef.current.set(newChunk.chunk_id!, detail);
                setChunk(prev => prev ? { ...prev, ...detail } : null);
              })
              .catch(() => {
                // 获取失败时使用已有数据
              })
              .finally(() => {
                setLoading(false);
              });
            setVisible(true);
          }
        } else {
          setVisible(true);
        }
      },
      hide: () => {
        setVisible(false);
        setTriggerRect(null);
      },
    }));

    // 关闭时清理触发元素位置
    useEffect(() => {
      if (!visible) {
        setTriggerRect(null);
      }
    }, [visible]);

    // 渲染 markdown 内容
    useEffect(() => {
      if (visible && chunk?.content && contentRef.current) {
        if (renderMarkdown) {
          // 先清空内容，避免重复渲染导致样式叠加
          contentRef.current.innerHTML = '';
          renderMarkdown(contentRef.current, chunk.content);
        } else {
          // 默认使用 pre-wrap 显示
          contentRef.current.innerHTML = '';
          const pre = document.createElement('pre');
          pre.className = 'whitespace-pre-wrap text-sm';
          pre.textContent = chunk.content;
          contentRef.current.appendChild(pre);
        }
      }
    }, [visible, chunk?.content, renderMarkdown]);

    // 关闭时清理内容
    useEffect(() => {
      if (!visible && contentRef.current) {
        contentRef.current.innerHTML = '';
      }
    }, [visible]);

    const handleOpenLibrary = useCallback(() => {
      if (chunk) {
        // 如果传入了回调，使用回调
        if (onOpenLibrary) {
          onOpenLibrary(chunk);
          return;
        }
        // 使用配置构建 URL
        const url = buildLibraryUrl(config, chunk.library_id, chunk.file_id, chunk);
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      }
    }, [chunk, onOpenLibrary, config]);

    const isWikiSearch = chunk?.chunk_type === ('wiki' as const)

    const content = chunk ? (
      <div className="overflow-hidden" style={{ width: DEFAULT_WIDTH }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 overflow-hidden">
            { isWikiSearch ?  (
              <>
                <div className="flex-shrink-0 size-5 rounded bg-[#EDF3FF] flex items-center justify-center text-[#2563EB]">
                  <SvgIcon name="doc-detail" size={16} />
                </div>
                <h3 className="flex-1 text-base text-[#1D1E1F] truncate">
                  {chunk.title}
                </h3>
              </>
            ) : (
              <>
                <img className="size-5" src={isRagSearch ? chunk.file_icon : chunk.library_icon} alt="" />
                <h3 className="flex-1 text-base text-[#1D1E1F] truncate">
                  {isRagSearch ? chunk.file_name : chunk.library_name}
                </h3>
              </>
            )
            }
            
            {isWikiSearch ? (
              <>
                <div className="h-5 bg-[#F0F5FF] px-2 rounded flex items-center text-sm text-[#2563EB]">
                  {chunk.page_type}
                </div>
                <span className="text-sm text-[#999999]">
                  V{chunk.version_no || 0}
                </span>
              </>
            ) : isRagSearch && (
              <>
                <span className=" text-sm text-[#999999]">
                  #{chunk.chunk_index || 0}
                </span>
                <div className="h-2.5 w-px bg-[#dbdbdb]"></div>
                <span className="text-sm text-[#999999]">
                  {chunk.token_count || 0} Token
                </span>
              </>
            )}
          </div>
          <Button
            type="link"
            size="small"
            onClick={() => setVisible(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            <CloseOutlined />
          </Button>
        </div>

        {/* File link for web search */}
        {!isRagSearch && chunk.file_path && (
          <a
            className="text-base text-[#2563EB] block mb-3"
            href={chunk.file_path}
            target="_blank"
            rel="noopener noreferrer"
          >
            {chunk.file_name}
          </a>
        )}

        {/* Content */}
        <div className="max-h-56 overflow-auto">
          <Spin spinning={loading}>
            <div className="text-sm text-gray-700" ref={contentRef}>
              {loading ? null : (chunk.content || '')}
            </div>
          </Spin>
        </div>

        {/* Footer */}
        {isRagSearch && (
          <div className="flex items-center justify-between mt-4">
            <div className="flex-1 flex items-center gap-1.5 overflow-hidden">
              { isWikiSearch ? <span className="flex-1 text-sm text-[#1D1E1F] truncate">
                {chunk.space_name && `${chunk.space_name}`}
              </span> : <span className="flex-1 text-sm text-[#1D1E1F] truncate">
                {chunk.space_name && `${chunk.space_name}/`}
                {chunk.library_name}
              </span> }
            </div>
            <Button
              color="primary"
              variant="filled"
              onClick={handleOpenLibrary}
            >
              { isWikiSearch ? '查看动态知识' : t("source.view_document") }
              <SvgIcon name="share"></SvgIcon>
            </Button>
          </div>
        )}
      </div>
    ) : null;

    // 触发 span 定位到虚拟 ref 元素的位置
    const triggerStyle: React.CSSProperties = triggerRect
      ? {
          position: "fixed",
          left: triggerRect.left,
          top: triggerRect.top,
          width: Math.max(triggerRect.width, 1),
          height: Math.max(triggerRect.height, 1),
          pointerEvents: "none",
          zIndex: -1,
        }
      : { display: "none" };

    return (
      <Popover
        open={visible}
        onOpenChange={(open) => {
          if (!open) {
            setVisible(false);
            setTriggerRect(null);
          }
        }}
        placement="bottomLeft"
        trigger="click"
        content={content}
        classNames={{ container: "!p-4" }}
      >
        <span style={triggerStyle} />
      </Popover>
    );
  }
);

Chunk.displayName = 'Chunk';

export default Chunk;
