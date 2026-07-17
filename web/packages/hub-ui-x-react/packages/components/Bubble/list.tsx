import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
  memo,
} from "react";
import "./list.css";

interface Message {
  id: string | number;
  [key: string]: any;
}

export interface BubbleListProps {
  className?: string;
  autoScroll?: boolean;
  messages?: Message[];
  enablePullUp?: boolean;
  pullUpText?: string;
  enablePullDown?: boolean;
  pullDownText?: string;
  mainClass?: string;
  mainStyle?: React.CSSProperties;
  scrollDownButton?: boolean;
  onPullUp?: (done: () => void) => void;
  onPullDown?: (done: () => void) => void;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  renderItem?: (message: Message, index: number) => React.ReactNode;
  children?: React.ReactNode;
}

export interface BubbleListRef {
  scrollToBottom: () => void;
  /** 获取内部 DOM 元素 */
  getWrapperElement: () => HTMLDivElement | null;
}

const BubbleListInner = forwardRef<BubbleListRef, BubbleListProps>(
  (
    {
      className = "",
      autoScroll = true,
      messages = [],
      enablePullUp = false,
      pullUpText = "",
      enablePullDown = false,
      pullDownText = "",
      mainClass = "",
      mainStyle = {},
      scrollDownButton = true,
      onPullUp,
      onPullDown,
      header,
      footer,
      renderItem,
      children,
    },
    ref,
  ) => {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const userScrolled = useRef(false);
    const observerRef = useRef<MutationObserver | null>(null);
    // RAF 节流：每帧最多触发一次滚动
    const pendingRafRef = useRef<number | null>(null);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isLoadingNew, setIsLoadingNew] = useState(false);
    const lastMessageLength = useRef(0);
    const lastMessageId = useRef<string | number | undefined>(undefined);
    // 用于加载历史数据时保持滚动位置
    const savedScrollHeightRef = useRef(0);

    const scrollToBottom = useCallback(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!wrapperRef.current) return;
      wrapperRef.current.scrollTop = wrapperRef.current.scrollHeight;
      requestAnimationFrame(() => {
        if (wrapperRef.current) {
          wrapperRef.current.scrollTop = wrapperRef.current.scrollHeight;
        }
      });
    }, []);

    const handleScroll = useCallback(() => {
      if (!wrapperRef.current) return;

      const { scrollTop, scrollHeight, clientHeight } = wrapperRef.current;

      // 检测滚动到顶部 - 加载更早的消息
      if (scrollTop < 50 && !isLoadingMore && enablePullUp) {
        // 保存当前滚动高度，用于加载历史数据后恢复位置
        savedScrollHeightRef.current = scrollHeight;
        setIsLoadingMore(true);
        onPullUp?.(() => {
          setIsLoadingMore(false);
        });
      }

      // 滚动到底部时重置 userScrolled 标志
      if (scrollHeight - scrollTop - clientHeight < 50) {
        userScrolled.current = false;

        // 检测滚动到底部 - 加载更新的消息
        if (!isLoadingNew && enablePullDown) {
          setIsLoadingNew(true);
          onPullDown?.(() => {
            setIsLoadingNew(false);
          });
        }
      }
    }, [
      isLoadingMore,
      isLoadingNew,
      enablePullUp,
      enablePullDown,
      onPullUp,
      onPullDown,
    ]);

    // 检测真正的用户滚动（wheel/touchmove），而不是内容变化导致的被动滚动
    const handleUserScroll = useCallback(() => {
      // 向上滚动时标记用户已滚动
      if (!wrapperRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = wrapperRef.current;
      if (scrollHeight - scrollTop - clientHeight > 50) {
        userScrolled.current = true;
      }
    }, []);

    const observeContentChanges = useCallback(() => {
      if (!wrapperRef.current) return;

      // RAF 节流的滚动处理函数
      const scheduleScroll = () => {
        // 如果已有待处理的 RAF，不重复创建
        if (pendingRafRef.current !== null) return;

        pendingRafRef.current = requestAnimationFrame(() => {
          pendingRafRef.current = null;

          if (!wrapperRef.current) return;
          if (!autoScroll || userScrolled.current) return;

          scrollToBottom();
        });
      };

      observerRef.current = new MutationObserver(scheduleScroll);

      observerRef.current.observe(wrapperRef.current, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }, [autoScroll, scrollToBottom]);

    useEffect(() => {
      const newLen = messages?.length ?? 0;
      const newLastId = messages?.[messages.length - 1]?.id;
      const prevLen = lastMessageLength.current;
      const prevLastId = lastMessageId.current;

      if (!autoScroll) {
        lastMessageLength.current = newLen;
        lastMessageId.current = newLastId;
        savedScrollHeightRef.current = 0;
        return;
      }

      // 消息数量增加
      if (newLen > prevLen) {
        // 检查是否是加载历史数据（消息 prepend 到前面）
        // 条件：最后一条消息ID没变，且之前保存了滚动高度
        const isLoadingHistory =
          newLastId === prevLastId &&
          prevLastId !== undefined &&
          savedScrollHeightRef.current > 0;

        if (isLoadingHistory && wrapperRef.current) {
          const prevScrollHeight = savedScrollHeightRef.current;
          requestAnimationFrame(() => {
            if (wrapperRef.current) {
              const newScrollHeight = wrapperRef.current.scrollHeight;
              wrapperRef.current.scrollTop = newScrollHeight - prevScrollHeight;
            }
          });
        } else {
          // 新消息添加到末尾，滚动到底部
          userScrolled.current = false;
          scrollToBottom();
        }
        savedScrollHeightRef.current = 0;
      } else if (newLen === prevLen && newLastId !== prevLastId) {
        // 消息数量不变，但最后一条消息ID变了（新消息替换），滚动到底部
        userScrolled.current = false;
        scrollToBottom();
      }
      // 消息数量和最后一条ID都不变，不滚动（如点击文件预览）

      lastMessageLength.current = newLen;
      lastMessageId.current = newLastId;
    }, [autoScroll, messages, scrollToBottom]);

    useEffect(() => {
      observeContentChanges();

      const wrapper = wrapperRef.current;
      wrapper?.addEventListener("scroll", handleScroll);
      wrapper?.addEventListener("wheel", handleUserScroll, { passive: true });
      wrapper?.addEventListener("touchmove", handleUserScroll, { passive: true });

      return () => {
        wrapper?.removeEventListener("scroll", handleScroll);
        wrapper?.removeEventListener("wheel", handleUserScroll);
        wrapper?.removeEventListener("touchmove", handleUserScroll);
        observerRef.current?.disconnect();
        // 清理待处理的 RAF
        if (pendingRafRef.current !== null) {
          cancelAnimationFrame(pendingRafRef.current);
          pendingRafRef.current = null;
        }
      };
    }, [observeContentChanges, handleScroll, handleUserScroll]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToBottom,
        getWrapperElement: () => wrapperRef.current,
      }),
      [scrollToBottom],
    );

    return (
      <div
        ref={wrapperRef}
        className={`bubble-wrapper ${className}`}
        onScroll={handleScroll}
      >
        {isLoadingMore && (
          <div className="bubble-wrapper-indicator">
            <span>{pullUpText}</span>
          </div>
        )}

        <div className={mainClass} style={mainStyle}>
          {header}
          {children
            ? children
            : messages.map((message, index) => (
                <div key={message.id} className="message-item">
                  {renderItem?.(message, index)}
                </div>
              ))}
          {footer}
        </div>

        {isLoadingNew && (
          <div className="bubble-wrapper-indicator">
            <span>{pullDownText}</span>
          </div>
        )}
      </div>
    );
  },
);

// 自定义比较函数
const arePropsEqual = (
  prevProps: BubbleListProps,
  nextProps: BubbleListProps,
): boolean => {
  // messages 数组长度变化需要重渲染
  if (prevProps.messages?.length !== nextProps.messages?.length) {
    return false;
  }

  // children、header、footer 引用变化需要重渲染
  if (
    prevProps.children !== nextProps.children ||
    prevProps.header !== nextProps.header ||
    prevProps.footer !== nextProps.footer
  ) {
    return false;
  }

  // 其他静态 props 比较关键属性
  return (
    prevProps.className === nextProps.className &&
    prevProps.autoScroll === nextProps.autoScroll &&
    prevProps.enablePullUp === nextProps.enablePullUp &&
    prevProps.enablePullDown === nextProps.enablePullDown
  );
};

const BubbleList = memo(BubbleListInner, arePropsEqual);

BubbleList.displayName = "xBubbleList";

export default BubbleList;
