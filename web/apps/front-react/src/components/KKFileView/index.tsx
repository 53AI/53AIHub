import { useRef, useEffect, useMemo, useCallback, useState } from "react";
import { message, Spin, Button } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { getKkfileviewUrl } from "@/utils/config";
import { copyToClip } from "@km/shared-utils";

// Utility function for base64 encoding
const base64Encode = (str: string): string => {
  return btoa(unescape(encodeURIComponent(str)));
};

interface KKFileViewProps {
  url: string;
}

type LoadingStatus = "loading" | "ready" | "converting" | "complete" | "error";

export function KKFileView({ url }: KKFileViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<LoadingStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [retryKey, setRetryKey] = useState(0); // 用于强制重新加载 iframe

  // 仅 .doc / .docx / .pdf 需要 kkfileview 的"转换服务"（officePreviewType=pdf）；
  // 图片、txt 等其他格式 kkfileview 拿到 URL 直接渲染，没有"转换"阶段。
  const isDoc = useMemo(() => {
    const pathname = url.split("?")[0];
    return (
      pathname.endsWith(".doc") ||
      pathname.endsWith(".docx") ||
      pathname.endsWith(".pdf")
    );
  }, [url]);

  // onMessage 闭包需要读取最新 isDoc，用 ref 避免把它加入 useCallback deps
  // （否则 URL 变更时 listener 会反复重绑，连接超时也会被重置）
  const isDocRef = useRef(isDoc);
  useEffect(() => {
    isDocRef.current = isDoc;
  }, [isDoc]);

  const previewUrl = useMemo(() => {
    const kk = getKkfileviewUrl();
    if (!kk) return "";
    const realUrl = encodeURIComponent(base64Encode(url));
    const forceParams = url.includes("knowledge_file_")
      ? ""
      : "&forceUpdatedCache=true";
    return isDoc
      ? `${kk}/onlinePreview?url=${realUrl}&officePreviewType=pdf${forceParams}`
      : `${kk}/onlinePreview?url=${realUrl}${forceParams}`;
  }, [url, isDoc]);

  // 清除超时定时器
  const clearTimeout = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // 设置超时检测
  const startTimeout = useCallback(
    (phase: "connect" | "convert") => {
      clearTimeout();
      const timeout = phase === "connect" ? 30000 : 60000; // 连接30秒，转换60秒
      timeoutRef.current = window.setTimeout(() => {
        setLoadingStatus("error");
        setErrorMessage(
          phase === "connect"
            ? "预览服务响应超时，请检查服务状态"
            : "文件转换超时，请稍后重试",
        );
      }, timeout);
    },
    [clearTimeout],
  );

  // 重试
  const handleRetry = useCallback(() => {
    clearTimeout();
    setLoadingStatus("loading");
    setErrorMessage("");
    setRetryKey((k) => k + 1);
  }, [clearTimeout]);

  const onMessage = useCallback(
    (event: MessageEvent) => {
      // Handle kkfileview preview status messages
      if (event.data?.type === "kkfileview-preview-status") {
        const status = event.data.status;
        switch (status) {
          case "ready":
            clearTimeout(); // 收到 ready 消息，清除连接超时
            if (isDocRef.current) {
              // doc/pdf 需要 kkfileview 转 PDF，进入"ready + 转换超时"阶段
              setLoadingStatus("ready");
              startTimeout("convert");
            } else {
              // 其他格式 kkfileview 无需转换，ready 即完成
              setLoadingStatus("complete");
            }
            break;
          case "complete":
            clearTimeout();
            setLoadingStatus("complete");
            break;
          case "error":
            clearTimeout();
            setLoadingStatus("error");
            setErrorMessage(event.data.message || "加载失败");
            break;
        }
        return;
      }

      const text = event.data.text;

      switch (event.data.type) {
        case "menu-item-click":
          window.dispatchEvent(
            new CustomEvent("quick-command", {
              detail: {
                name: event.data.data.name,
                prompt: event.data.data.content,
                text,
              },
            }),
          );
          break;
        case "menu-item-copy":
          copyToClip(text).then(() => {
            message.success("已复制");
          });
          break;
        case "selection-change":
          window.dispatchEvent(
            new CustomEvent("selection-change", {
              detail: { text },
            }),
          );
          break;
        default:
          break;
      }
    },
    [clearTimeout, startTimeout],
  );

  const viewerEvent = useCallback((event: Event) => {
    const customEvent = event as CustomEvent<{ type: string; data: any }>;
    if (customEvent.detail.type === "menu") {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "menu", data: customEvent.detail.data },
        "*",
      );
    }
    if (customEvent.detail.type === "auto-select-enabled") {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "auto-select-enabled", data: customEvent.detail.data },
        "*",
      );
    }
  }, []);

  useEffect(() => {
    window.addEventListener("message", onMessage);
    window.addEventListener("viewer-event", viewerEvent);
    startTimeout("connect"); // 启动连接超时检测

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("viewer-event", viewerEvent);
      clearTimeout();
    };
  }, [onMessage, viewerEvent, startTimeout, clearTimeout, retryKey]);

  const loadingText = useMemo(() => {
    switch (loadingStatus) {
      case "loading":
        return "加载中...";
      case "ready":
        return "连接成功，准备转换...";
      case "converting":
        return "正在转换文件...";
      case "error":
        return errorMessage;
      default:
        return "";
    }
  }, [loadingStatus, errorMessage]);

  const isLoading = loadingStatus !== "complete" && loadingStatus !== "error";

  // iframe 加载失败
  const handleIframeError = useCallback(() => {
    clearTimeout();
    setLoadingStatus("error");
    setErrorMessage("预览服务连接失败");
  }, [clearTimeout]);

  return (
    <div className="relative w-full h-full">
      {isLoading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/90">
          <Spin size="large" />
          <p className="mt-3 text-gray-600">{loadingText}</p>
        </div>
      )}
      {loadingStatus === "error" && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/90">
          <p className="mb-4 text-red-500">{errorMessage}</p>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={handleRetry}
          >
            重试
          </Button>
        </div>
      )}
      <iframe
        key={retryKey}
        ref={iframeRef}
        src={previewUrl}
        width="100%"
        height="100%"
        frameBorder="0"
        title="File Preview"
        onError={handleIframeError}
      />
    </div>
  );
}

export default KKFileView;
