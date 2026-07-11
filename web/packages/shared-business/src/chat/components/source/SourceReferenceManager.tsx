// packages/shared-business/src/chat/components/source/SourceReferenceManager.tsx

import { useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import Chunk, { type ChunkRef, type ChunkProps } from './popups/Chunk';
import Graph, { type GraphRef } from './popups/Graph';
import type { ChunkItem, Message, SourceReferenceData } from '../../types/message';

export interface SourceReferenceManagerRef {
  /** 处理源引用标记点击 */
  handleSourceReferenceClick: (data: SourceReferenceData, msg: Message) => void;
  /** 处理源引用点击（从 ProcessFlow） */
  handleSourceClick: (source: ChunkItem, msg: Message) => void;
}

export interface SourceReferenceManagerProps {
  /** 获取 chunk 详情回调 */
  fetchChunkDetail?: ChunkProps['fetchChunkDetail'];
  /** Markdown 渲染回调 */
  renderMarkdown?: ChunkProps['renderMarkdown'];
  /** 打开文档回调 */
  onOpenLibrary?: ChunkProps['onOpenLibrary'];
  /** 查看图谱回调 */
  onGraphView?: (info: ChunkItem) => void;
  /** 未找到 chunk 时的回调 */
  onChunkNotFound?: (data: SourceReferenceData) => void;
}

const SourceReferenceManager = forwardRef<SourceReferenceManagerRef, SourceReferenceManagerProps>(
  ({ fetchChunkDetail, renderMarkdown, onOpenLibrary, onGraphView, onChunkNotFound }, ref) => {
    const chunkRef = useRef<ChunkRef>(null);
    const chunkSourceRef = useRef<HTMLDivElement | null>(null);
    const graphRef = useRef<GraphRef>(null);
    const graphSourceRef = useRef<HTMLDivElement | null>(null);

    // 处理源引用点击 - 打开弹窗
    const handleSourceClick = useCallback((source: ChunkItem, msg: Message) => {
      if (source.chunk_type === 'graph_result') {
        graphSourceRef.current = null;
        graphRef.current?.setLibraryInfo(source, msg.rag_stats?.type);
      } else {
        chunkSourceRef.current = null;
        chunkRef.current?.setLibraryInfo(source, msg.rag_stats?.type);
      }
    }, []);

    // 处理源引用标记点击（如 [1], [2]）
    const handleSourceReferenceClick = useCallback((data: SourceReferenceData, msg: Message) => {
      const chunks = msg.rag_stats?.chunks || [];
      const key = `[Source:${data.sourceType}-${data.sourceNumber}]`;

      // 先尝试通过 source_key 匹配
      let chunk = chunks.find((item: ChunkItem) => item.source_key === key || item.source === key);

      // 如果没找到，尝试通过索引匹配
      if (!chunk) {
        const index = data.sourceNumber - 1;
        chunk = chunks[index];
      }

      if (chunk) {
        // 根据类型打开对应的弹窗
        if (chunk.chunk_type === 'graph_result') {
          graphSourceRef.current = data.element || null;
          graphRef.current?.setLibraryInfo(chunk, msg.rag_stats?.type);
        } else {
          chunkSourceRef.current = data.element || null;
          chunkRef.current?.setLibraryInfo(chunk, msg.rag_stats?.type);
        }
      } else {
        onChunkNotFound?.(data);
      }
    }, [onChunkNotFound]);

    useImperativeHandle(ref, () => ({
      handleSourceReferenceClick,
      handleSourceClick,
    }));

    return (
      <>
        <Chunk
          ref={chunkRef}
          virtualRef={chunkSourceRef}
          fetchChunkDetail={fetchChunkDetail}
          renderMarkdown={renderMarkdown}
          onOpenLibrary={onOpenLibrary}
        />
        <Graph
          ref={graphRef}
          virtualRef={graphSourceRef}
          onView={onGraphView}
        />
      </>
    );
  }
);

SourceReferenceManager.displayName = 'SourceReferenceManager';

/**
 * 创建源引用点击处理器
 * 用于直接传递给 ChatMessages 的 onSourceReferenceClick
 */
export function createSourceReferenceHandler(
  ref: React.RefObject<SourceReferenceManagerRef | null>
) {
  return (data: SourceReferenceData, msg: Message) => {
    ref.current?.handleSourceReferenceClick(data, msg);
  };
}

/**
 * 创建源点击处理器
 * 用于直接传递给 ChatMessages 的 onSourceClick
 */
export function createSourceClickHandler(
  ref: React.RefObject<SourceReferenceManagerRef | null>
) {
  return (source: ChunkItem, msg: Message) => {
    ref.current?.handleSourceClick(source, msg);
  };
}

export default SourceReferenceManager;