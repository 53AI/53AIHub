import { LeftOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { SvgIcon } from "@km/shared-components-react";
import type { PageHeaderConfig } from "./types";

interface PageHeaderProps {
  config: PageHeaderConfig | string;
  className?: string;
}

/** 渲染标题 - 字符串用 h2 包裹，ReactNode 直接渲染 */
function TitleText({ title, className }: { title: React.ReactNode; className?: string }) {
  if (typeof title === 'string') {
    return <h2 className={className}>{title}</h2>;
  }
  return <>{title}</>;
}

/** 渲染描述 - 字符串用容器包裹，ReactNode 直接渲染 */
function DescText({ desc, className }: { desc: React.ReactNode; className?: string }) {
  if (typeof desc === 'string') {
    return <span className={className}>{desc}</span>;
  }
  return <>{desc}</>;
}

export function PageHeader({ config, className = "" }: PageHeaderProps) {
  const navigate = useNavigate();

  // 简写模式：只传字符串标题
  if (typeof config === "string") {
    return (
      <div className={`flex-none flex items-center gap-4 ${className}`}>
        <h2 className="text-[26px] text-primary font-semibold">{config}</h2>
      </div>
    );
  }

  const {
    title,
    description,
    icon,
    back,
    onBack,
    titlePrefix,
    titleSuffix,
    center,
    right,
  } = config;

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      const state = window.history.state || {};
      const hasHistory = state.idx !== undefined ? state.idx > 0 : false;
      navigate(hasHistory ? -1 : (config.fallbackPath || "/"));
    }
  };

  // 有图标模式
  if (icon) {
    return (
      <div className={`flex items-center gap-4 ${className}`}>
        <div
          className={`size-[60px] flex items-center justify-center rounded-lg ${icon.bgColor || "bg-[#5899FC]"}`}
          style={icon.customStyle}
        >
          {icon.svgIcon ? (
            <SvgIcon
              name={icon.svgIcon}
              size={icon.size || 32}
              color={icon.color || "white"}
            />
          ) : (
            <img className={icon.className || "size-8"} src={icon.src} alt="" />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <TitleText title={title} className="text-[22px] text-primary font-bold" />
          {description && (
            <DescText desc={description} className="text-sm text-placeholder" />
          )}
        </div>
        {center}
        <div className="flex-1" />
        {right}
      </div>
    );
  }

  // 无图标模式 - 有描述时用小标题
  if (description) {
    return (
      <div className={`flex-none flex items-center gap-4 ${className}`}>
        <div className="flex-1 flex items-center gap-2">
          {back && (
            <div
              className="w-7 h-7 flex items-center justify-center cursor-pointer hover:bg-gray-100 rounded"
              onClick={handleBack}
            >
              <LeftOutlined style={{ fontSize: 16 }} />
            </div>
          )}
          {titlePrefix}
          <div className="flex flex-col">
            <TitleText title={title} className="text-sm font-medium text-gray-900" />
            <DescText desc={description} className="text-xs text-gray-400 truncate max-w-[400px]" />
          </div>
        </div>
        <div className="flex-none flex justify-center">{center}</div>
        <div className="flex-1 flex justify-end">{right}</div>
      </div>
    );
  }

  // 无图标模式 - 无描述时用大标题
  return (
    <div className={`flex-none flex items-center gap-4 ${className}`}>
      <div className="flex-1 flex items-center gap-3">
        {back && (
          <div
            className="w-7 h-7 flex items-center justify-center cursor-pointer hover:bg-gray-100 rounded"
            onClick={handleBack}
          >
            <LeftOutlined style={{ fontSize: 18 }} />
          </div>
        )}
        {titlePrefix}
        <TitleText title={title} className="text-[26px] text-primary font-semibold" />
        {titleSuffix}
      </div>
      <div className="flex-none flex justify-center">{center}</div>
      <div className="flex-1 flex justify-end">{right}</div>
    </div>
  );
}
