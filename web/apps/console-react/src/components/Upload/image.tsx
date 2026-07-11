import { useRef, useState, forwardRef, useImperativeHandle } from "react";
import CropperDialog from "@/components/CropperDialog";
import { PlusOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { t } from "@/locales";

const DEFAULT_IMG = "/images/default_agent.png";

const failedUrls = new Set<string>();

function getFallback(customUrl?: string): string {
  if (customUrl) return customUrl;
  if (typeof window !== "undefined" && (window as any).$getRealPath) {
    return (window as any).$getRealPath({ url: DEFAULT_IMG });
  }
  return DEFAULT_IMG;
}

export interface ImageUploadRef {
  trigger: () => void;
}

export interface ImageUploadProps {
  value?: string;
  onChange?: (url: string) => void;
  onConfirm?: (result: { url: string }) => void;
  text?: string;
  showText?: boolean;
  cropperDisabled?: boolean;
  allowTypeList?: string[];
  disabled?: boolean;
  fixed?: boolean;
  fixedNumber?: number[];
  fixedBox?: boolean;
  className?: string;
  children?: React.ReactNode;
  maskText?: React.ReactNode;
  /** 自定义默认图片 */
  defaultImg?: string;
}

export const ImageUpload = forwardRef<ImageUploadRef, ImageUploadProps>(
  function ImageUpload(
    {
      value = "",
      onChange,
      onConfirm,
      text = "action_replace",
      showText = false,
      cropperDisabled = false,
      allowTypeList,
      disabled = false,
      fixed,
      fixedNumber,
      fixedBox,
      className = "",
      children,
      maskText,
      defaultImg,
    },
    ref
  ) {
    const cropperRef = useRef<{ uploadFile: () => void }>(null);
    const [imgError, setImgError] = useState(false);

    const handleSelectFile = (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (disabled) return;
      cropperRef.current?.uploadFile();
    };

    const handleConfirm = (data: { url: string }) => {
      onChange?.(data.url);
      onConfirm?.({ url: data.url });
      setImgError(false);
    };

    const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      const currentSrc = img.src;
      const fallback = getFallback(defaultImg);

      // 避免循环
      if (currentSrc.endsWith(fallback)) return;

      failedUrls.add(currentSrc);
      img.src = fallback;
      setImgError(true);
    };

    // 暴露 trigger 方法给父组件
    useImperativeHandle(ref, () => ({
      trigger: handleSelectFile,
    }));

    // 显示的图片 URL
    const displaySrc = value && !imgError ? value : getFallback(defaultImg);

  return (
    <>
      <div
        className={`w-[50px] h-[50px] rounded overflow-hidden relative cursor-pointer group ${disabled ? "cursor-not-allowed" : ""} ${className}`}
        onClick={handleSelectFile}
      >
        {children ? (
          children
        ) : showText ? (
          <Button type="link" style={{ padding: 0 }} disabled={disabled}>
            {t(text)}
          </Button>
        ) : (
          <>
            {value ? (
              <img
                className="w-full h-full object-cover"
                src={displaySrc}
                alt="logo"
                onError={handleImageError}
              />
            ) : (
              <div className="upload-image-placeholder w-full h-full flex items-center justify-center border rounded border-gray-200">
                <PlusOutlined style={{ fontSize: 16, color: "#9A9A9A" }} />
              </div>
            )}
            <div className="hidden group-hover:flex absolute top-0 right-0 bottom-0 left-0 bg-black bg-opacity-40 items-center justify-center text-xs text-white gap-6">
              {maskText || t(text)}
            </div>
          </>
        )}
      </div>

      <CropperDialog
        ref={cropperRef}
        action="python"
        fixed={fixed}
        fixedNumber={fixedNumber}
        fixedBox={fixedBox}
        cropperDisabled={cropperDisabled}
        allowTypeList={allowTypeList}
        onConfirm={handleConfirm}
      />
      <style>{`
        .ant-form-item-has-error .upload-image-placeholder {
          border-color: #f56c6c;
        }
      `}</style>
    </>
  );
  }
);

export default ImageUpload;
