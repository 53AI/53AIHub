import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { calculateTooltipPosition, adjustPosition } from '../../utils/tooltip';
import './index.css';

interface TooltipProps {
  placement?: 'top' | 'bottom' | 'left' | 'right';
  trigger?: 'hover' | 'click';
  visible?: boolean;
  className?: string;
  style?: React.CSSProperties;
  content: string;
  children: React.ReactNode;
  onVisibleChange?: (visible: boolean) => void;
}

const debounce = (fn: Function, delay: number) => {
  let timer: NodeJS.Timeout | null = null;
  return function (this: any, ...args: any[]) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
};

const Tooltip: React.FC<TooltipProps> = ({
  placement = 'top',
  trigger = 'hover',
  visible,
  className = '',
  style = {},
  content,
  children,
  onVisibleChange
}) => {
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0, placement });
  const [localVisible, setLocalVisible] = useState(false);

  const isControlled = visible !== undefined;
  const isVisible = isControlled ? visible : localVisible;

  const tooltipStyle = useMemo(() => ({
    ...style,
    position: 'absolute' as const,
    left: `${tooltipPosition.left}px`,
    top: `${tooltipPosition.top}px`,
  }), [style, tooltipPosition]);

  const tooltipClass = useMemo(() => [
    'hub-tooltip',
    `hub-tooltip-${tooltipPosition.placement || placement}`,
    className
  ].join(' '), [tooltipPosition.placement, placement, className]);

  const updatePosition = useCallback(() => {
    if (triggerRef.current && tooltipRef.current) {
      const newPosition = calculateTooltipPosition(
        triggerRef.current,
        tooltipRef.current,
        placement
      );
      setTooltipPosition(adjustPosition(newPosition));
    }
  }, [placement]);

  const setVisible = useCallback((value: boolean) => {
    if (isControlled) {
      onVisibleChange?.(value);
    } else {
      setLocalVisible(value);
    }
  }, [isControlled, onVisibleChange]);

  const hideTooltip = useCallback(() => {
    setVisible(false);
  }, [setVisible]);

  const debouncedHide = useMemo(() => debounce(hideTooltip, 100), [hideTooltip]);
  const debouncedShow = useMemo(() => debounce(() => setVisible(true), 100), [setVisible]);

  const handleMouseEnter = useCallback(() => {
    if (trigger === 'hover') {
      debouncedShow();
    }
  }, [trigger, debouncedShow]);

  const handleMouseLeave = useCallback(() => {
    if (trigger === 'hover') {
      debouncedHide();
    }
  }, [trigger, debouncedHide]);

  const handleClick = useCallback(() => {
    if (trigger === 'click') {
      setVisible(!isVisible);
    }
  }, [trigger, isVisible, setVisible]);

  const handleGlobalEvents = useCallback(() => {
    hideTooltip();
  }, [hideTooltip]);

  useEffect(() => {
    if (isVisible) {
      setTimeout(() => {
        updatePosition();
      }, 0);

      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition);
      window.addEventListener('fullscreenchange', handleGlobalEvents);
      window.addEventListener('webkitfullscreenchange', handleGlobalEvents);
      window.addEventListener('mozfullscreenchange', handleGlobalEvents);
      window.addEventListener('MSFullscreenChange', handleGlobalEvents);

      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition);
        window.removeEventListener('fullscreenchange', handleGlobalEvents);
        window.removeEventListener('webkitfullscreenchange', handleGlobalEvents);
        window.removeEventListener('mozfullscreenchange', handleGlobalEvents);
        window.removeEventListener('MSFullscreenChange', handleGlobalEvents);
      };
    }
  }, [isVisible, updatePosition, handleGlobalEvents]);

  return (
    <>
      <div
        ref={triggerRef}
        className="tooltip-trigger"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {children}
      </div>
      {isVisible && createPortal(
        <div
          ref={tooltipRef}
          className={tooltipClass}
          style={tooltipStyle}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
};

Tooltip.displayName = 'xTooltip';

export default Tooltip;
