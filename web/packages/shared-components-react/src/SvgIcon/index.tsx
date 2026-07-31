import React, { forwardRef } from "react";
import type { CSSProperties, MouseEventHandler } from "react";

export type SvgIconProps = {
  name: string;
  size?: number | string;
  width?: number | string;
  height?: number | string;
  color?: string;
  stroke?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: MouseEventHandler<SVGSVGElement>;
};

const toLength = (value: number | string | undefined): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return `${value}px`;
  // 字符串已带 CSS 单位则原样使用；否则补 px，避免 "16" 这种裸数字被浏览器忽略（Firefox 下回退到 SVG 默认尺寸）
  return /^-?\d+(\.\d+)?$/.test(value.trim()) ? `${value}px` : value;
};

export const SvgIcon = forwardRef<SVGSVGElement, SvgIconProps>(
  ({ name, size = 16, width, height, color, className, style, onClick }, ref) => {
    const s = toLength(size);
    const w = toLength(width);
    const h = toLength(height);

    return (
      <svg
        ref={ref}
        className={className}
        style={{
          width: w ?? s,
          height: h ?? s,
          fill: color ?? "currentColor",
          color: color ?? "currentColor",
          ...style,
        }}
        onClick={onClick}
        aria-hidden
      >
        <use href={`#icon-${name}`} />
      </svg>
    );
  },
);

SvgIcon.displayName = "SvgIcon";

export default SvgIcon;
