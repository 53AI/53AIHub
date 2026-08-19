/**
 * / 技能下拉弹窗组件
 */

import React, { useEffect, useRef } from 'react';
import type { SkillDropdownSlotProps, SkillItem } from '../types';
import Icon from '../../Icon/index';
import { t } from '../../../locale/index';

export interface SkillDropdownProps extends SkillDropdownSlotProps {
  className?: string;
}

const SkillDropdown: React.FC<SkillDropdownProps> = ({
  suggestions,
  searchKeyword,
  searchLoading,
  selectedIndex,
  onSelect,
  onSearchChange,
  onOpenLibrary,
  onClose,
  onCancel,
  style,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动聚焦输入框
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange(e.target.value);
  };

  const handleItemClick = (skill: SkillItem) => {
    onSelect(skill);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Esc 必须把 chip 还原成普通字符,而不仅是关掉下拉 —— 否则
      // `<span class="skill-input">/</span>` 会继续以 chip 形式留在编辑器里。
      if (onCancel) {
        onCancel();
      } else {
        onClose?.();
      }
    }
  };

  // 获取显示名称（兼容 label 和 display_name）
  const getDisplayName = (skill: SkillItem) => {
    return skill.label || skill.display_name || '';
  };

  // 获取图标（兼容 img 和 icon）
  const getIcon = (skill: SkillItem) => {
    return skill.logo || skill.icon;
  };

  return (
    <div
      className={`x-sender__skill-dropdown ${className}`}
      style={style}
      onKeyDown={handleKeyDown}
    >
      {/* 搜索框 */}
      <div className="x-sender__dropdown-search">
        <div className="x-sender__dropdown-search-inner">
          <input
            ref={inputRef}
            type="text"
            value={searchKeyword}
            onChange={handleInputChange}
            placeholder={t('hubx.bubble.search_skill') || '搜索技能'}
            className="x-sender__dropdown-input"
          />
          {searchLoading && (
            <div className="x-sender__dropdown-loading">
              <Icon name="loading" />
            </div>
          )}
        </div>
      </div>

      {/* 列表 */}
      <div className="x-sender__dropdown-list">
        {suggestions.map((skill, index) => (
          <div
            key={skill.id || index}
            className={`x-sender__dropdown-item ${selectedIndex === index ? 'x-sender__dropdown-item--selected' : ''}`}
            onClick={() => handleItemClick(skill)}
          >
            <div className="x-sender__dropdown-item-icon">
              {getIcon(skill) ? (
                <img src={getIcon(skill)} className="x-sender__dropdown-item-img" alt="" />
              ) : (
                <Icon name="skill" />
              )}
            </div>
            <div className="x-sender__dropdown-item-content">
              <div className="x-sender__dropdown-item-name">
                {getDisplayName(skill)}
              </div>
              {skill.description && (
                <div className="x-sender__dropdown-item-desc">{skill.description}</div>
              )}
            </div>
          </div>
        ))}

        {searchLoading && suggestions.length === 0 && (
          <div className="x-sender__dropdown-empty">
            <Icon name="loading" />
            <span>加载中...</span>
          </div>
        )}

        {!searchLoading && suggestions.length === 0 && (
          <div className="x-sender__dropdown-empty">
            {searchKeyword.trim() ? (t('hubx.bubble.no_matched_skill') || '没有找到相关技能') : (t('hubx.bubble.no_skill') || '暂无可用技能')}
          </div>
        )}
      </div>

      {/* 技能库入口 */}
      {onOpenLibrary && (
        <div className="x-sender__dropdown-footer" onClick={onOpenLibrary}>
          <Icon name="skill" />
          <span className="x-sender__dropdown-footer-text">{t('hubx.bubble.go_skill_library') || '去技能库添加'}</span>
          <Icon name="right" />
        </div>
      )}
    </div>
  );
};

export default SkillDropdown;