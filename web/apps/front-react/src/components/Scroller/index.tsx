import {
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
  ReactNode,
} from "react";

import { debounce } from "@km/shared-utils";
import "./scroller.css";

interface ScrollerProps {
  disableTop?: boolean;
  disableBottom?: boolean;
  threshold?: number;
  debounceTime?: number;
  children?: ReactNode;
  topLoadingSlot?: ReactNode;
  bottomLoadingSlot?: ReactNode;
  onLoadTop?: (done: () => void) => void;
  onLoadBottom?: (done: () => void) => void;
}

export interface ScrollerRef {
  scrollToTop: (behavior?: ScrollBehavior) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  prepareTopLoad: () => void;
  adjustScrollPosition: () => void;
}

export const Scroller = forwardRef<ScrollerRef, ScrollerProps>(
  (
    {
      disableTop = false,
      disableBottom = false,
      threshold = 50,
      debounceTime = 200,
      children,
      topLoadingSlot,
      bottomLoadingSlot,
      onLoadTop,
      onLoadBottom,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [topLoading, setTopLoading] = useState(false);
    const [bottomLoading, setBottomLoading] = useState(false);
    const lastScrollTop = useRef(0);
    const previousScrollHeight = useRef(0);

    const checkPosition = useCallback(
      debounce(() => {
        if (!containerRef.current) return;

        const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
        const currentScroll = scrollTop;

        const isScrollingDown = currentScroll > lastScrollTop.current;
        lastScrollTop.current = currentScroll;

        const isAtTop = currentScroll <= threshold;
        const isAtBottom =
          currentScroll + clientHeight >= scrollHeight - threshold;

        if (!isScrollingDown && isAtTop && !disableTop) {
          setTopLoading(true);
          onLoadTop?.(() => {
            setTopLoading(false);
          });
        }

        if (isScrollingDown && isAtBottom && !disableBottom) {
          setBottomLoading(true);
          onLoadBottom?.(() => {
            setBottomLoading(false);
          });
        }
      }, debounceTime),
      [
        threshold,
        debounceTime,
        disableTop,
        disableBottom,
        onLoadTop,
        onLoadBottom,
      ],
    );

    const handleScroll = () => {
      checkPosition();
    };

    const scrollToTop = useCallback((behavior: ScrollBehavior = "smooth") => {
      containerRef.current?.scrollTo({
        top: 0,
        behavior,
      });
    }, []);

    const scrollToBottom = useCallback(
      (behavior: ScrollBehavior = "smooth") => {
        if (!containerRef.current) return;
        const { scrollHeight, clientHeight } = containerRef.current;
        containerRef.current.scrollTo({
          top: scrollHeight - clientHeight,
          behavior,
        });
      },
      [],
    );

    const prepareTopLoad = useCallback(() => {
      if (containerRef.current) {
        previousScrollHeight.current = containerRef.current.scrollHeight;
      }
    }, []);

    const adjustScrollPosition = useCallback(() => {
      setTimeout(() => {
        if (!containerRef.current) return;
        const newScrollHeight = containerRef.current.scrollHeight;
        const diff = newScrollHeight - previousScrollHeight.current;
        if (diff > 0) {
          containerRef.current.scrollTop += diff;
        }
      }, 0);
    }, []);

    useImperativeHandle(ref, () => ({
      scrollToTop,
      scrollToBottom,
      prepareTopLoad,
      adjustScrollPosition,
    }));

    return (
      <div
        ref={containerRef}
        className="scroll-container"
        onScroll={handleScroll}
      >
        <div className="scroll-content">
          {!disableTop && (
            <div
              className={`load-indicator top-indicator ${topLoading ? "visible" : ""}`}
            >
              {topLoadingSlot || (
                <div className="loader">
                  <div className="loader-spinner" />
                </div>
              )}
            </div>
          )}

          {children}

          {!disableBottom && (
            <div
              className={`load-indicator bottom-indicator ${bottomLoading ? "visible" : ""}`}
            >
              {bottomLoadingSlot || (
                <div className="loader">
                  <div className="loader-spinner" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
);

export default Scroller;
