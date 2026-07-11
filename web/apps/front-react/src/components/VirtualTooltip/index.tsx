import { useEffect, useRef, useState, ReactNode, useCallback } from "react";
import { createPortal } from "react-dom";
import "./index.css";

export interface VirtualTooltipProps {
  /** Reference element to position the tooltip relative to */
  virtualRef: React.RefObject<HTMLElement | null>;
  /** Whether the tooltip is visible */
  open: boolean;
  /** Tooltip content */
  title: ReactNode;
  /** Placement relative to the reference element */
  placement?: "right-start" | "right" | "right-end" | "left-start" | "left" | "left-end";
  /** Whether the tooltip is disabled */
  disabled?: boolean;
  /** Custom class name for the tooltip */
  overlayClassName?: string;
  /** Custom style for the tooltip */
  overlayStyle?: React.CSSProperties;
  /** Z-index for the tooltip */
  zIndex?: number;
  /** Called when tooltip visibility changes */
  onOpenChange?: (open: boolean) => void;
}

interface Position {
  top: number;
  left: number;
}

/**
 * A tooltip component that can be positioned relative to a virtual reference element,
 * similar to Element Plus's virtual-triggering feature.
 */
export function VirtualTooltip({
  virtualRef,
  open,
  title,
  placement = "right-start",
  disabled = false,
  overlayClassName = "",
  overlayStyle = {},
  zIndex = 1060,
  onOpenChange,
}: VirtualTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });
  const [visible, setVisible] = useState(false);

  // Calculate position based on reference element
  const calculatePosition = useCallback(() => {
    const refElement = virtualRef?.current;
    if (!refElement) return { top: 0, left: 0 };

    const rect = refElement.getBoundingClientRect();
    const tooltipWidth = tooltipRef.current?.offsetWidth || 120;
    const tooltipHeight = tooltipRef.current?.offsetHeight || 200;
    const gap = 8; // Gap between reference and tooltip

    let top = 0;
    let left = 0;

    switch (placement) {
      case "right-start":
        top = rect.top;
        left = rect.right + gap;
        break;
      case "right":
        top = rect.top + (rect.height - tooltipHeight) / 2;
        left = rect.right + gap;
        break;
      case "right-end":
        top = rect.bottom - tooltipHeight;
        left = rect.right + gap;
        break;
      case "left-start":
        top = rect.top;
        left = rect.left - tooltipWidth - gap;
        break;
      case "left":
        top = rect.top + (rect.height - tooltipHeight) / 2;
        left = rect.left - tooltipWidth - gap;
        break;
      case "left-end":
        top = rect.bottom - tooltipHeight;
        left = rect.left - tooltipWidth - gap;
        break;
      default:
        top = rect.top;
        left = rect.right + gap;
    }

    // Ensure tooltip stays within viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (left + tooltipWidth > viewportWidth) {
      left = rect.left - tooltipWidth - gap;
    }
    if (left < 0) {
      left = gap;
    }
    if (top + tooltipHeight > viewportHeight) {
      top = viewportHeight - tooltipHeight - gap;
    }
    if (top < 0) {
      top = gap;
    }

    return { top, left };
  }, [virtualRef, placement]);

  // Update position when open state changes
  useEffect(() => {
    if (open && !disabled) {
      // Small delay to allow DOM to render for accurate measurements
      const timer = setTimeout(() => {
        setPosition(calculatePosition());
        setVisible(true);
      }, 16);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [open, disabled, calculatePosition]);

  // Update position on scroll and resize
  useEffect(() => {
    if (!visible) return;

    const handleUpdate = () => {
      setPosition(calculatePosition());
    };

    window.addEventListener("scroll", handleUpdate, true);
    window.addEventListener("resize", handleUpdate);

    return () => {
      window.removeEventListener("scroll", handleUpdate, true);
      window.removeEventListener("resize", handleUpdate);
    };
  }, [visible, calculatePosition]);

  if (disabled || !visible) {
    return null;
  }

  return createPortal(
    <div
      ref={tooltipRef}
      className={`virtual-tooltip ${overlayClassName}`}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex,
        ...overlayStyle,
      }}
      onMouseEnter={() => onOpenChange?.(true)}
      onMouseLeave={() => onOpenChange?.(false)}
    >
      <div className="virtual-tooltip-content">{title}</div>
    </div>,
    document.body,
  );
}

export default VirtualTooltip;