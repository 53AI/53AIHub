import { useState, useRef, useCallback, useEffect } from "react";

const STORAGE_KEY = "recording-float-position";
const DRAG_THRESHOLD = 5;
const EDGE_MARGIN = 8;

interface DraggablePosition {
  side: "left" | "right";
  top: number;
}

interface UseDraggableOptions {
  storageKey?: string;
  initialSide?: "left" | "right";
  initialTop?: number;
  edgeMargin?: number;
  dragThreshold?: number;
  /** Callback when a click (not drag) occurs */
  onClick?: () => void;
}

interface UseDraggableResult {
  position: DraggablePosition;
  isDragging: boolean;
  handleDragStart: (e: React.MouseEvent | React.TouchEvent) => void;
}

export function useDraggable(options: UseDraggableOptions = {}): UseDraggableResult {
  const {
    storageKey = STORAGE_KEY,
    initialSide = "right",
    initialTop = 32,
    edgeMargin = EDGE_MARGIN,
    dragThreshold = DRAG_THRESHOLD,
    onClick,
  } = options;

  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<DraggablePosition>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) return JSON.parse(stored) as DraggablePosition;
    } catch {}
    return { side: initialSide, top: initialTop };
  });

  const [isDragging, setIsDragging] = useState(false);

  const positionRef = useRef(position);
  positionRef.current = position;

  const clampTop = useCallback((top: number) => {
    const minTop = edgeMargin;
    const maxTop = window.innerHeight - (ref.current?.offsetHeight || 44) - edgeMargin;
    return Math.max(minTop, Math.min(maxTop, top));
  }, [edgeMargin]);

  const clampTopRef = useRef(clampTop);
  clampTopRef.current = clampTop;

  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

    const startX = clientX;
    const startY = clientY;
    const startTop = positionRef.current.top;
    let hasMoved = false;

    setIsDragging(true);

    const handleMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > dragThreshold || Math.abs(dy) > dragThreshold) {
        hasMoved = true;
      }
      const newTop = clampTopRef.current(startTop + dy);
      setPosition(prev => ({ ...prev, top: newTop }));
    };

    const handleMouseUp = (ev: MouseEvent) => {
      cleanup();
      setIsDragging(false);

      if (!hasMoved) {
        // This was a click, not a drag
        onClick?.();
        return;
      }

      // Snap to edge
      const newSide = ev.clientX < window.innerWidth / 2 ? "left" : "right";
      const newTop = clampTopRef.current(positionRef.current.top);
      const newPosition = { side: newSide, top: newTop };
      setPosition(newPosition);
      try { localStorage.setItem(storageKey, JSON.stringify(newPosition)); } catch {}
    };

    const handleTouchMove = (ev: TouchEvent) => {
      ev.preventDefault();
      if (ev.touches.length !== 1) return;
      const dx = ev.touches[0].clientX - startX;
      const dy = ev.touches[0].clientY - startY;
      if (Math.abs(dx) > dragThreshold || Math.abs(dy) > dragThreshold) {
        hasMoved = true;
      }
      const newTop = clampTopRef.current(startTop + dy);
      setPosition(prev => ({ ...prev, top: newTop }));
    };

    const handleTouchEnd = (ev: TouchEvent) => {
      cleanup();
      setIsDragging(false);

      if (!hasMoved) {
        onClick?.();
        return;
      }

      const lastTouch = ev.changedTouches[0];
      const newSide = lastTouch.clientX < window.innerWidth / 2 ? "left" : "right";
      const newTop = clampTopRef.current(positionRef.current.top);
      const newPosition = { side: newSide, top: newTop };
      setPosition(newPosition);
      try { localStorage.setItem(storageKey, JSON.stringify(newPosition)); } catch {}
    };

    const cleanup = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
  }, [dragThreshold, storageKey, onClick]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setPosition(prev => ({ ...prev, top: clampTopRef.current(prev.top) }));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return { position, isDragging, handleDragStart };
}

export default useDraggable;
