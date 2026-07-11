export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: string | number;
  placement?: TooltipPlacement;
  visible?: boolean;
  trigger?: 'hover' | 'click';
  class?: string;
  style?: any;
}

export interface Position {
  left: number;
  top: number;
  placement?: TooltipPlacement;
}

export const calculateTooltipPosition = (
  triggerElement: HTMLElement,
  tooltipElement: HTMLElement,
  placement: TooltipPlacement
): Position => {
  const triggerRect = triggerElement.getBoundingClientRect();
  const tooltipRect = tooltipElement.getBoundingClientRect();
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = 0;
  let top = 0;
  let finalPlacement = placement;

  // 检查是否需要切换位置
  if (placement === 'top') {
    const wouldOverflowTop = triggerRect.top - tooltipRect.height - 8 < 0;
    if (wouldOverflowTop) {
      finalPlacement = 'bottom';
    }
  } else if (placement === 'bottom') {
    const wouldOverflowBottom = triggerRect.bottom + tooltipRect.height + 8 > viewportHeight;
    if (wouldOverflowBottom) {
      finalPlacement = 'top';
    }
  } else if (placement === 'left') {
    const wouldOverflowLeft = triggerRect.left - tooltipRect.width - 8 < 0;
    if (wouldOverflowLeft) {
      finalPlacement = 'right';
    }
  } else if (placement === 'right') {
    const wouldOverflowRight = triggerRect.right + tooltipRect.width + 8 > viewportWidth;
    if (wouldOverflowRight) {
      finalPlacement = 'left';
    }
  }

  // 根据最终位置计算坐标
  switch (finalPlacement) {
    case 'top':
      left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2 + scrollLeft;
      top = triggerRect.top - tooltipRect.height - 8 + scrollTop;
      break;
    case 'bottom':
      left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2 + scrollLeft;
      top = triggerRect.bottom + 8 + scrollTop;
      break;
    case 'left':
      left = triggerRect.left - tooltipRect.width - 8 + scrollLeft;
      top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2 + scrollTop;
      break;
    case 'right':
      left = triggerRect.right + 8 + scrollLeft;
      top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2 + scrollTop;
      break;
  }

  return { left, top, placement: finalPlacement };
};

export const adjustPosition = (position: Position): Position => {
  const { left, top, placement } = position;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  return {
    left: Math.min(Math.max(0, left), viewportWidth),
    top: Math.min(Math.max(0, top), viewportHeight),
    placement,
  };
};
