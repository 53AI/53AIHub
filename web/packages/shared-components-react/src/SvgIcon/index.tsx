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

export const SvgIcon = forwardRef<SVGSVGElement, SvgIconProps>(
  ({ name, size = 16, width, height, color, className, style, onClick }, ref) => {
    const s = typeof size === "number" ? `${size}px` : size;
    const w = typeof width === "number" ? `${width}px` : width;
    const h = typeof height === "number" ? `${height}px` : height;

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
