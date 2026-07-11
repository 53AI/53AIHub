import React, { useState, forwardRef, useImperativeHandle, useCallback, useEffect, useRef } from 'react';
import { Popover, Button, Spin } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { SvgIcon } from '@km/shared-components-react';
import { useEnv } from '@/hooks/useEnv';
import chunksApi from '@/api/modules/chunks';

export interface ChunkRef {
  setLibraryInfo: (info: any, type?: string) => void;
  hide: () => void;
}

interface ChunkProps {
  virtualRef?: React.RefObject<HTMLElement | null>;
}

const Chunk = forwardRef<ChunkRef, ChunkProps>(({ virtualRef }, ref) => {
  const [visible, setVisible] = useState(false);
  const [libraryInfo, setLibraryInfo] = useState<any>(null);
  const [searchType, setSearchType] = useState('rag_search');
  const [loading, setLoading] = useState(false);
  const { buildFrontLibraryFileUrl } = useEnv();

  // 锚点元素 ref
  const anchorRef = useRef<HTMLDivElement>(null);

  const isRagSearch = searchType === 'rag_search';

  // 更新锚点位置到虚拟元素位置
  useEffect(() => {
    if (virtualRef?.current && anchorRef.current) {
      const rect = virtualRef.current.getBoundingClientRect();
      anchorRef.current.style.left = `${rect.left}px`;
      anchorRef.current.style.top = `${rect.top}px`;
      anchorRef.current.style.width = `${rect.width}px`;
      anchorRef.current.style.height = `${rect.height}px`;
    }
  });

  const fetchChunkData = useCallback(async (chunkId: string) => {
    setLoading(true);
    try {
      const res = await chunksApi.get(chunkId);
      setLibraryInfo((prev: any) => ({
        ...prev,
        ...res,
        content: res.content || prev?.content,
      }));
    } catch (err) {
      console.error('获取 chunk 详情失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useImperativeHandle(ref, () => ({
    setLibraryInfo: (info: any, type: string = 'rag_search') => {
      setSearchType(type);
      setLibraryInfo({
        ...info,
        token_count: info.token_count || 0,
        chunk_index: info.chunk_index || 0,
      });
      setVisible(true);
      // 获取 chunk 详情
      if (type === 'rag_search' && info.chunk_id) {
        fetchChunkData(info.chunk_id);
      }
    },
    hide: () => setVisible(false),
  }));

  const handleClose = () => {
    setVisible(false);
  };

  const handleOpenLibrary = () => {
    if (!libraryInfo) return;
    const url = buildFrontLibraryFileUrl(libraryInfo.library_id, libraryInfo.file_id);
    window.open(url, '_blank');
  };

  const content = libraryInfo && (
    <div className="p-4 w-[600px] bg-white rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <img
            className="w-5 h-5"
            src={isRagSearch ? libraryInfo.file_icon : libraryInfo.library_icon}
            alt="icon"
          />
          <h3 className="flex-1 text-base text-gray-800 truncate">
            {isRagSearch ? libraryInfo.file_name : libraryInfo.library_name}
          </h3>
          {isRagSearch && (
            <>
              <span className="text-sm text-gray-500">#{libraryInfo.chunk_index}</span>
              <div className="h-2.5 w-px bg-gray-300"></div>
              <span className="text-sm text-gray-500">{libraryInfo.token_count} Token</span>
            </>
          )}
        </div>
        <Button type="text" icon={<CloseOutlined />} onClick={handleClose} />
      </div>

      {!isRagSearch && (
        <a className="text-base text-blue-600 block mb-3" href={libraryInfo.file_path} target="_blank" rel="noreferrer">
          {libraryInfo.file_name}
        </a>
      )}

      <div className="max-h-56 overflow-auto space-y-2">
        <Spin spinning={loading}>
          <div className="text-sm text-gray-700 whitespace-pre-wrap">
            {libraryInfo.content}
          </div>
        </Spin>
      </div>

      {isRagSearch && (
        <div className="flex items-center justify-between mt-4">
          <div className="flex-1 flex items-center gap-1.5 overflow-hidden">
            <span className="flex-1 text-sm text-gray-800 truncate">
              {libraryInfo.space_name ? `${libraryInfo.space_name}/` : ''}{libraryInfo.library_name}
            </span>
          </div>
          <Button type="primary" ghost className="border-none" onClick={handleOpenLibrary}>
            查看文档 <SvgIcon name="share" size={14} className="ml-1" />
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      open={visible}
      onOpenChange={setVisible}
      trigger="click"
      placement="bottomLeft"
      styles={{ root: { padding: 0 } }}
    >
      {/* 锚点元素：当有 virtualRef 时，定位到虚拟元素位置 */}
      <div
        ref={anchorRef}
        style={{
          position: 'fixed',
          left: virtualRef?.current ? undefined : -9999,
          top: virtualRef?.current ? undefined : -9999,
          width: virtualRef?.current ? 0 : 0,
          height: virtualRef?.current ? 0 : 0,
          pointerEvents: 'none',
        }}
      />
    </Popover>
  );
});

Chunk.displayName = 'Chunk';

export default Chunk;