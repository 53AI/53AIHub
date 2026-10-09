import { useRef, useEffect, useMemo, useCallback } from "react";
import { message } from "antd";
import { getKkfileviewUrl } from "@/utils/config";
import { copyToClip } from "@km/shared-utils";

// Utility function for base64 encoding
const base64Encode = (str: string): string => {
  return btoa(unescape(encodeURIComponent(str)));
};

interface KKFileViewProps {
  url: string;
  /** 文件 SHA-256（来自 upload_file.hash），合法时走 kkfileview 内容级缓存 */
  fileHash?: string;
}

const isValidSha256 = (h?: string) => !!h && /^[a-f0-9]{64}$/i.test(h);

export function KKFileView({ url, fileHash }: KKFileViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const previewUrl = useMemo(() => {
    const kk = getKkfileviewUrl();
    if (!kk) return "";
    const realUrl = encodeURIComponent(base64Encode(url));
    const pathname = url.split("?")[0];
    const isDoc =
      pathname.endsWith(".doc") ||
      pathname.endsWith(".docx") ||
      pathname.endsWith(".pdf");

    // 有合法 hash：走 kkfileview 内容级缓存（同文件复用转换结果），不再强制刷新
    const cacheParams = isValidSha256(fileHash) ? `&fileHash=${fileHash}` : "&forceUpdatedCache=true";
    if (isDoc) {
      return `${kk}/onlinePreview?url=${realUrl}&officePreviewType=pdf${cacheParams}`;
    }
    return `${kk}/onlinePreview?url=${realUrl}${cacheParams}`;
  }, [url, fileHash]);

  const onMessage = useCallback((event: MessageEvent) => {
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
  }, []);

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

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("viewer-event", viewerEvent);
    };
  }, [onMessage, viewerEvent]);

  return (
    <iframe
      ref={iframeRef}
      src={previewUrl}
      width="100%"
      height="100%"
      frameBorder="0"
      title="File Preview"
    />
  );
}

export default KKFileView;
