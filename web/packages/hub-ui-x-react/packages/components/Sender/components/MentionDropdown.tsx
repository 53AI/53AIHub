/**
 * @ 提及下拉弹窗组件
 */

import React, { useMemo, useEffect, useRef } from 'react';
import type { MentionDropdownSlotProps, MentionDocItem } from '../types';
import Icon from '../../Icon/index';

export interface MentionDropdownProps extends MentionDropdownSlotProps {
  className?: string;
}

const MentionDropdown: React.FC<MentionDropdownProps> = ({
  suggestions,
  recentList = [],
  searchKeyword,
  searchLoading,
  selectedIndex,
  onSelect,
  onSearchChange,
  onOpenLibrary,
  onClose,
  onCancel,
  style,
  enhanced = false,
  hasKnowledgeBase = true,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // 合并建议列表
  const displayList = useMemo(() => {
    const keyword = searchKeyword.trim();
    // 搜索态:空结果即空态,不回落到「最近访问」
    if (keyword) {
      return suggestions;
    }
    if (recentList.length > 0) {
      return recentList.slice(0, 5);
    }
    return suggestions.slice(0, 5);
  }, [searchKeyword, suggestions, recentList]);

  // 自动聚焦输入框
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange(e.target.value);
  };

  const handleItemClick = (item: MentionDocItem) => {
    onSelect(item);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Esc 必须把 chip 还原成普通字符,而不仅是关掉下拉 —— 否则
      // `<span class="mention-input">@</span>` 会继续以 chip 形式留在编辑器里。
      if (onCancel) {
        onCancel();
      } else {
        onClose?.();
      }
    }
  };

  return (
    <div
      className={`x-sender__mention-dropdown ${className}`}
      style={style}
      onKeyDown={handleKeyDown}
    >
      {/* 搜索框（增强版模式） */}
      {enhanced && (
        <div className="x-sender__dropdown-search">
          <input
            ref={inputRef}
            type="text"
            value={searchKeyword}
            onChange={handleInputChange}
            placeholder="搜索文件"
            className="x-sender__dropdown-input"
          />
          {searchLoading && (
            <div className="x-sender__dropdown-loading">
              <Icon name="loading" />
            </div>
          )}
        </div>
      )}

      {/* 最近访问 */}
      {hasKnowledgeBase && !searchKeyword.trim() && (
        <div className="x-sender__dropdown-header">
          <span className="x-sender__dropdown-title">最近访问</span>
          {onClose && (
            <div className="x-sender__dropdown-close" onClick={onClose}>
              <Icon name="close" />
            </div>
          )}
        </div>
      )}

      {/* 列表 */}
      <div className="x-sender__dropdown-list">
        {/* 搜索中只展示 loading,不与(上一次关键词的)列表同时展示 */}
        {searchKeyword.trim() && searchLoading ? (
          <div className="x-sender__dropdown-empty">
            <Icon name="loading" />
            <span>搜索中...</span>
          </div>
        ) : displayList.length === 0 ? (
          <div className="x-sender__dropdown-empty">
            {searchKeyword.trim() ? '没有找到相关文件' : '没有匹配项'}
          </div>
        ) : (
          displayList.map((item, index) => (
            <div
              key={item.id}
              className={`x-sender__dropdown-item ${selectedIndex === index ? 'x-sender__dropdown-item--selected' : ''}`}
              onClick={() => handleItemClick(item)}
            >
              <div className="x-sender__dropdown-item-icon">
                {item.icon ? (
                  <img src={item.icon} className="x-sender__dropdown-item-img" alt="" />
                ) : (
                  <Icon name="file" />
                )}
              </div>
              <div className="x-sender__dropdown-item-name">{item.name}</div>
            </div>
          ))
        )}
      </div>

      {/* 知识库入口 */}
      {hasKnowledgeBase && onOpenLibrary && (
        <div className="x-sender__dropdown-footer" onClick={onOpenLibrary}>
          <span className="x-sender__dropdown-footer-text">@ 选择指定内容</span>
          <Icon name="right" />
        </div>
      )}
    </div>
  );
};

export default MentionDropdown;