import { useState, useEffect, useRef, useCallback } from 'react';
import {
  CloseOutlined,
  LeftOutlined,
  EditOutlined,
  DownloadOutlined
} from '@ant-design/icons';
import { Button, message, Modal, Skeleton } from 'antd';
import { SvgIcon } from "@km/shared-components-react";
import { copyToClip } from "@km/shared-utils";
import FileViewer from '@/components/FileViewer';
import { FullscreenToggle } from '@/components/FullscreenToggle';
import { IconButton } from '@/components/IconButton';
import ChunkEditor, { ChunkEditorRef } from '@/components/Markdown/ChunkEditor';
import { t } from '@/locales';
import memoryApi from '@/api/modules/memory';
import { splitByHeadings, formatToolLessons } from './hooks/useMemory';
import type { MemoryTypeItem, MemoryItem, ToolLessonItem } from '@/api/modules/memory/types';

interface UserMemoryDetailProps {
  agentId: string | number;
  file: MemoryTypeItem;
  onBack?: () => void;
  onClose?: () => void;
  fullscreen: boolean;
  onToggle: () => void;
  composeClassName: (base: string) => string;
}

export function UserMemoryDetail({ agentId, file, onBack, onClose, fullscreen, onToggle, composeClassName }: UserMemoryDetailProps) {
  const fileName = file.name.replace(/\.md$/, '');
  const isMemoryFile = file.name === 'MEMORY.md';

  // 内容状态
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');

  // 编辑状态
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // 用于标记刚保存完成
  const justSavedRef = useRef(false);
  // ChunkEditor 引用，用于直接获取编辑器当前值
  const chunkEditorRef = useRef<ChunkEditorRef>(null);

  // MEMORY.md 空内容时的默认展示结构
  const EMPTY_MEMORY_TEMPLATE = `## 偏好/习惯

## 核心事实/项目知识`;

  // TOOLS.md 空内容时的默认展示结构
  const EMPTY_TOOLS_TEMPLATE = `记录各种工具的使用技巧和注意事项

* **常用工具注意事项：**
* **特殊场景工具调用注意事项：**`;

  // 加载记忆内容
  useEffect(() => {
    const fetchContent = async () => {
      setLoading(true);
      try {
        if (isMemoryFile) {
          const data = await memoryApi.agent.getMemory(agentId);
          if (data) {
            // 解析 items，把所有 fact 拼接起来展示
            const items = data.items ? JSON.parse(data.items) : [];
            // version 为 0 且内容为空时，展示默认模板
            const content = data.version === 0 && items.length === 0
              ? EMPTY_MEMORY_TEMPLATE
              : items.map((item: MemoryItem) => item.fact || '').join('\n\n');
            setContent(content);
            setSavedContent(content);
          }
        } else {
          // TOOLS.md：格式化展示
          const data = await memoryApi.agent.getToolLessons(agentId);
          if (data) {
            const lessons = data.lessons ? JSON.parse(data.lessons) : [];
            // version 为 0 且内容为空时，展示默认模板
            const content = data.version === 0 && lessons.length === 0
              ? EMPTY_TOOLS_TEMPLATE
              : formatToolLessons(lessons);
            setContent(content);
            setSavedContent(content);
          }
        }
      } catch (error) {
        console.error('Failed to fetch memory content:', error);
        message.error('加载失败');
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [agentId, isMemoryFile, file.version]);

  // 检测是否有未保存变更
  const hasUnsavedChanges = useCallback(() => {
    if (justSavedRef.current) return false;
    // 直接从编辑器获取当前值，避免快速点击时状态还未更新的问题
    const currentEditContent = chunkEditorRef.current?.getValue() || editContent;
    // 规范化比较：去除 Vditor 自动转义 + 只比较非空白行
    const normalize = (str: string) => {
      if (!str) return '';
      // 还原 Vditor 自动转义的下划线、星号等 Markdown 特殊字符
      const unescaped = str.replace(/\\_/g, '_').replace(/\\\*/g, '*');
      return unescaped.split('\n').filter(line => line.trim()).join('\n');
    };
    const normalizedEdit = normalize(currentEditContent);
    const normalizedSaved = normalize(savedContent);
    // 有变更：正在编辑 且 内容不同于保存值
    return isEditing && normalizedEdit !== normalizedSaved;
  }, [isEditing, savedContent, editContent]);

  // 有未保存变更时弹出确认对话框
  const handleUnsavedCheck = (callback: () => void) => () => {
    if (hasUnsavedChanges()) {
      Modal.confirm({
        title: t('common.tip'),
        content: t('common.unsaved_changes'),
        okText: t('action.confirm'),
        cancelText: t('action.cancel'),
        onOk: () => {
          setIsEditing(false);
          callback();
        },
      });
    } else {
      callback();
    }
  };

  // 刷新/关闭页面时提示
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) {
        const msg = t('common.unsaved_changes');
        event.preventDefault();
        event.returnValue = msg;
        return msg;
      }
      return undefined;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // 进入编辑模式
  const handleEdit = () => {
    setEditContent(savedContent);
    setIsEditing(true);
    justSavedRef.current = false;
  };

  // 编辑内容变化
  const handleEditChange = (value: string) => {
    setEditContent(value);
  };

  // 保存
  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);

    try {
      if (isMemoryFile) {
        // MEMORY.md：按标题分割，每段作为一个 fact
        const trimmed = editContent.trim();
        const facts = trimmed ? splitByHeadings(trimmed) : [];
        const items = facts.map(fact => ({ fact }));
        const data = await memoryApi.agent.replaceMemory(agentId, { items: JSON.stringify(items) });
        if (data) {
          // 重新解析 items 拼接展示
          const newItems = data.items ? JSON.parse(data.items) : [];
          const newContent = newItems.length > 0
            ? newItems.map((item: MemoryItem) => item.fact || '').join('\n\n')
            : '';
          setContent(newContent);
          setSavedContent(newContent);
          setIsEditing(false);
          justSavedRef.current = true;
          message.success(t('action.save_success'));
        }
      } else {
        // TOOLS.md：按标题分割，每段作为一个 lesson
        const trimmed = editContent.trim();
        const facts = trimmed ? splitByHeadings(trimmed) : [];
        const lessons = facts.map(lesson => ({ lesson }));
        const data = await memoryApi.agent.replaceToolLessons(agentId, { lessons: JSON.stringify(lessons) });
        if (data) {
          const newLessons = data.lessons ? JSON.parse(data.lessons) : [];
          const newContent = newLessons.length > 0
            ? newLessons.map((item: ToolLessonItem) => item.lesson || '').filter(Boolean).join('\n\n')
            : '';
          setContent(newContent);
          setSavedContent(newContent);
          setIsEditing(false);
          justSavedRef.current = true;
          message.success(t('action.save_success'));
        }
      }
    } catch (error) {
      console.error('Failed to save memory:', error);
      message.error('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  // 返回
  const handleBack = handleUnsavedCheck(() => onBack?.());

  // 复制
  const handleCopy = async () => {
    await copyToClip(savedContent);
    message.success(t('action.copy_success'));
  };

  // 下载
  const handleDownload = () => {
    const blob = new Blob([savedContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={composeClassName('h-full bg-white flex flex-col')}>
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-[#F0F0F0]">
        <div className="flex items-center gap-3">
          <IconButton
            title={t('action.back')}
            size="compact"
            onClick={handleBack}
          >
            <LeftOutlined style={{ fontSize: '16px' }} />
          </IconButton>
          <span className="text-base">{fileName}</span>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && (
            <>
              <IconButton
                title={t('action.edit')}
                size="compact"
                onClick={handleEdit}
              >
                <EditOutlined style={{ fontSize: '16px' }} />
              </IconButton>
              <div className="h-4 border-r border-[#E6E8EB]" />
              <IconButton
                title={t('action.download')}
                size="compact"
                onClick={handleDownload}
              >
                <DownloadOutlined style={{ fontSize: '16px' }} />
              </IconButton>
              <IconButton
                title={t('action.copy')}
                size="compact"
                onClick={handleCopy}
              >
                <SvgIcon name="copy" size="16" />
              </IconButton>
            </>
          )}
          <FullscreenToggle
            fullscreen={fullscreen}
            onToggle={onToggle}
          />
          <IconButton
            title={t('action.close')}
            size="compact"
            onClick={handleUnsavedCheck(() => onClose?.())}
          >
            <CloseOutlined style={{ fontSize: '16px' }} />
          </IconButton>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="p-4">
              <Skeleton active />
              <Skeleton active />
              <Skeleton active paragraph={{ rows: 4 }} />
            </div>
          ) : isEditing ? (
            <ChunkEditor
              ref={chunkEditorRef}
              value={editContent}
              onChange={handleEditChange}
              height="100%"
            />
          ) : savedContent && (
            <div className="h-full overflow-y-auto">
              <FileViewer
                content={savedContent}
                extension="md"
              />
            </div>
          )}
        </div>

        {/* 保存按钮区域 */}
        {isEditing && (
          <div className="flex-none h-14 flex items-center justify-end px-4 border-t border-[#F0F0F0]">
            <Button type="primary" loading={isSaving} onClick={handleSave}>
              {t('action.save')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default UserMemoryDetail;
