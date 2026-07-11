import { useState, useEffect } from 'react';
import { LeftOutlined } from '@ant-design/icons';
import { Skeleton } from 'antd';
import { SvgIcon } from "@km/shared-components-react";
import { UserMemoryDetail } from './detail';
import memoryApi from '@/api/modules/memory';
import type { MemoryTypeItem } from '@/api/modules/memory/types';

// 模块级别缓存，key 为 agentId
const memoryListCache = new Map<string | number, MemoryTypeItem[]>();

/**
 * 清除记忆列表缓存
 * @param agentId 可选，不传则清除所有缓存
 */
export const clearMemoryListCache = (agentId?: string | number) => {
  if (agentId !== undefined) {
    memoryListCache.delete(agentId);
  } else {
    memoryListCache.clear();
  }
};

interface UserMemoryProps {
  agentId: string | number;
  onClose?: () => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
}

export function UserMemory({ agentId, onClose, onToggleFullscreen, isFullscreen }: UserMemoryProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [memoryList, setMemoryList] = useState<MemoryTypeItem[]>(() => {
    // 初始化时先使用缓存
    return memoryListCache.get(agentId) || [];
  });
  const [loading, setLoading] = useState(() => {
    // 如果有缓存，初始不显示 loading
    return !memoryListCache.has(agentId);
  });

  useEffect(() => {
    // 如果已有缓存，不再请求
    if (memoryListCache.has(agentId)) {
      return;
    }

    const fetchMemoryList = async () => {
      setLoading(true);
      try {
        const data = await memoryApi.agent.memoryList(agentId);
        if (data) {
          memoryListCache.set(agentId, data);
          setMemoryList(data);
        }
      } catch (error) {
        console.error('Failed to fetch memory list:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMemoryList();
  }, [agentId]);

  const selectedFile = memoryList.find(f => f.path === selectedPath);

  if (selectedFile && selectedPath !== null) {
    return (
      <UserMemoryDetail
        agentId={agentId}
        file={selectedFile}
        onBack={() => setSelectedPath(null)}
        onClose={onClose}
        onToggleFullscreen={onToggleFullscreen}
        isFullscreen={isFullscreen}
      />
    );
  }

  return (
    <div className="h-full bg-white flex flex-col">
      {/* Header */}
      <div className="h-16 flex items-center px-4">
        <LeftOutlined className="text-primary cursor-pointer mr-3" onClick={onClose} />
        <span className="text-base text-primary">记忆文件</span>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton active paragraph={false} />
            <Skeleton active paragraph={false} />
          </div>
        ) : (
          <div className="space-y-2">
            {memoryList.map((file) => (
              <div
                key={file.path}
                onClick={() => setSelectedPath(file.path)}
                className={`h-9 flex items-center gap-2 px-3 rounded-lg cursor-pointer transition-colors ${
                  selectedPath === file.path ? 'bg-[#F0F0F0]' : 'hover:bg-[#F5F5F5]'
                }`}
              >
                <SvgIcon name="file_v2" />
                <span className="text-sm text-[#1D1E1F]">{file.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default UserMemory;
