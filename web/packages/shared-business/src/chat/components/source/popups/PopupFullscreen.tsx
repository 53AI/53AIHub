// packages/shared-business/src/chat/components/source/popups/PopupFullscreen.tsx

import { useCallback, useEffect, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons';
import { useTranslation } from '../../../i18n';

/**
 * 引用弹窗（Popover）全屏能力。
 *
 * Chunk / Graph 两个引用弹窗共用：
 * - usePopupFullscreen：全屏状态管理，弹窗关闭时自动复位（下次打开恢复常规尺寸）
 * - PopupFullscreenButton：头部全屏/缩小切换按钮（放在关闭按钮左侧）
 * - 全屏覆盖样式见 popups.css 的 .source-popover-fullscreen
 */

export interface UsePopupFullscreenReturn {
  /** 当前是否全屏 */
  isFullscreen: boolean;
  /** 切换全屏/缩小 */
  toggleFullscreen: () => void;
}

/**
 * 全屏状态管理。传入弹窗可见状态：关闭时自动退出全屏，
 * 避免下次打开时残留全屏布局。
 */
export function usePopupFullscreen(visible: boolean): UsePopupFullscreenReturn {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!visible) {
      setIsFullscreen(false);
    }
  }, [visible]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((v) => !v);
  }, []);

  return { isFullscreen, toggleFullscreen };
}

export interface PopupFullscreenButtonProps {
  /** 当前是否全屏 */
  isFullscreen: boolean;
  /** 点击切换全屏/缩小 */
  onToggle: () => void;
}

/** 全屏/缩小切换按钮：非全屏显示「全屏」(FullscreenOutlined)，全屏显示「缩小」(FullscreenExitOutlined) */
export function PopupFullscreenButton({ isFullscreen, onToggle }: PopupFullscreenButtonProps) {
  const { t } = useTranslation();
  return (
    <Tooltip title={isFullscreen ? t('source.exit_fullscreen') : t('source.fullscreen')}>
      <Button
        type="link"
        size="small"
        onClick={onToggle}
        className="text-gray-400 hover:text-gray-600"
      >
        {isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
      </Button>
    </Tooltip>
  );
}
