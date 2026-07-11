import { useState } from "react";
import { Popover, Button, Tooltip, message } from "antd";
import fileSharesApi from "@/api/modules/file-shares";
import { cacheManager, CacheMode, copyToClip } from "@km/shared-utils";
import { buildUrl } from "@/utils/router";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import "./share.css";

interface FileShareProps {
  fileId: string;
  fileName: string;
}

export function FileShare({ fileId, fileName }: FileShareProps) {
  const [shareUrl, setShareUrl] = useState("");

  const onSharePopoverShow = () => {
    // 缓存2个小时过期，避免频繁请求
    cacheManager
      .getOrFetch(
        `file-share-${fileId}`,
        () => {
          return fileSharesApi.create({
            file_id: fileId,
            // 7天
            expire_time: Date.now() + 7 * 24 * 60 * 60 * 1000
            // expire_time: Date.now() + 1 * 60 * 60 * 1000,
          });
        },
        1 * 60,
        CacheMode.COOKIE,
      )
      .then((res) => {
        setShareUrl(buildUrl(`/share/file/${res.share_id}`));
      });
  };

  const handleCopyShareUrl = () => {
    copyToClip("【" + fileName + "】" + shareUrl);
    message.success(t("status.copy_link"));
  };

  const handleCopyUrl = () => {
    copyToClip(shareUrl);
    message.success(t("common.copied"));
  };

  const content = (
    <div className="w-[400px]">
      <div className="flex items-center gap-1">
        <p className="text-base text-[#1D1E1F] font-medium">分享文档</p>
        <Tooltip title="分享的文档权限默认为仅查看">
          <SvgIcon name="question" />
        </Tooltip>
      </div>
      <div className="flex items-center border my-4">
        <div className="flex-1 px-4 text-sm text-[#4F5052] truncate">
          {shareUrl}
        </div>
        <div className="h-4 border-r" />
        <div
          className="h-9 flex-none flex items-center justify-center px-3 cursor-pointer hover:bg-[#F0F0F0]"
          onClick={handleCopyUrl}
        >
          <SvgIcon name="copy" />
        </div>
      </div>
      <Button
        style={{ backgroundColor: "#F5F6F7" }}
        onClick={handleCopyShareUrl}
      >
        <SvgIcon className="mr-1" name="link" />
        {t("action.copy_link")}
      </Button>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      onOpenChange={(open) => open && onSharePopoverShow()}
    >
      <Tooltip title="分享">
        <div className="size-8 rounded flex-center cursor-pointer hover:bg-[#F0F0F0]">
          <SvgIcon name="share-two" />
        </div>
      </Tooltip>
    </Popover>
  );
}

export default FileShare;
