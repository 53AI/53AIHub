import { forwardRef, useState } from "react";
import type { CSSProperties, ImgHTMLAttributes } from "react";
import { formatFileInfo } from "@km/shared-utils";

export interface FileIconProps {
  /**
   * 文件名（可包含路径，例如 "dir/foo.pdf" 或 "foo.md"）。
   * 组件从文件名后缀解析出扩展名，再通过 formatFileInfo 取得对应 icon 路径。
   * 后缀无法识别时，渲染一个内联绘制的"后缀徽章"作为兜底。
   */
  fileName?: string;
  /** 是否按文件夹解析（影响 formatFileInfo 中 icon 字段）。默认 false。 */
  isFolder?: boolean;
  className?: string;
  style?: CSSProperties;
  alt?: string;
  /** 透传给 <img> 的额外属性，例如 loading / decoding。 */
  imgProps?: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "className" | "style" | "onError">;
}

/**
 * 根据文件名后缀显示对应的文件 icon。
 * - 后缀命中已知类型：用 /images/file/${mime}.png 资源。
 * - 后缀未知 / 图片资源 404：内联渲染一个"后缀徽章"（背景 + 大写后缀居中），不依赖外部资源。
 */
export const FileIcon = forwardRef<HTMLImageElement, FileIconProps>(
  ({ fileName, isFolder = false, className, style, alt, imgProps }, ref) => {
    if (!fileName) return null;

    const { icon, ext } = formatFileInfo(fileName, isFolder);

    // 资源加载失败时回退到内联"后缀徽章"
    const [imgFailed, setImgFailed] = useState(false);
    const useBadge = !icon || imgFailed;

    if (useBadge) {
      return (
        <span
          className={`inline-flex items-center justify-center rounded bg-[#EEF0F4] text-[#5B6573] font-semibold tracking-tight select-none ${className || ""}`}
          style={style}
          title={alt || fileName}
        >
          <span className="text-[10px] leading-none uppercase">
            {ext || "FILE"}
          </span>
        </span>
      );
    }

    return (
      <img
        ref={ref}
        src={icon}
        alt={alt}
        className={className}
        style={style}
        onError={() => setImgFailed(true)}
        {...imgProps}
      />
    );
  },
);

FileIcon.displayName = "FileIcon";

export default FileIcon;
