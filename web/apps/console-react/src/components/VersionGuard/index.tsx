import React, {
  useMemo,
  useRef,
  useCallback,
  useEffect,
  useState,
} from "react";
import { Tooltip, Button } from "antd";
import { WarningFilled } from "@ant-design/icons";
import {
  checkVersion,
  showServiceDialog,
  checkVersionPermission,
} from "@/utils/version";
import type { VersionModule } from "@/constants/enterprise";
import { t } from "@/locales";
import { useEnterpriseStore } from "@/stores";

export type VersionGuardMode = "dialog" | "tooltip" | "remove";

export interface VersionGuardProps {
  /** 版本模块 */
  module: VersionModule;
  /** 当前数量 */
  count?: number;
  /** 模式：dialog(默认) | tooltip | remove */
  mode?: VersionGuardMode;
  /** 自定义提示内容 */
  content?: string;
  /** 版本不满足时的替代内容（remove 模式） */
  fallback?: React.ReactNode;
  /** tooltip 主题 */
  effect?: "dark" | "light";
  /** tooltip 位置 */
  placement?:
    | "top"
    | "topLeft"
    | "topRight"
    | "bottom"
    | "bottomLeft"
    | "bottomRight"
    | "left"
    | "leftTop"
    | "leftBottom"
    | "right"
    | "rightTop"
    | "rightBottom";
  /** 子元素 */
  children: React.ReactNode;
  /** 版本检查通过时的回调 */
  onClick?: () => void;
}

const UpgradeTooltipContent: React.FC<{ content?: string }> = ({ content }) => (
  <div className="version-tooltip-content flex items-center gap-2">
    <WarningFilled style={{ color: "#F0A105", fontSize: 16 }} />
    <div>{content || t("version.not_support")}</div>
    <Button
      type="link"
      size="small"
      className="px-0"
      onClick={() => showServiceDialog()}
    >
      {t("version.upgrade")}
    </Button>
  </div>
);

export function VersionGuard({
  module,
  count,
  mode = "dialog",
  content,
  fallback = null,
  effect = "light",
  placement = "topRight",
  children,
  onClick,
}: VersionGuardProps) {
  // 订阅 features 变化，确保版本信息异步加载后能正确响应
  const features = useEnterpriseStore((state) => state.version.features);
  const canUse = useMemo(() => checkVersion(module, count), [module, count, features]);
  const childRef = useRef<HTMLElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  // tooltip 模式：处理鼠标悬停
  const handleMouseEnter = useCallback(() => {
    if (mode === "tooltip" && !canUse) {
      setShowTooltip(true);
    }
  }, [mode, canUse]);

  const handleMouseLeave = useCallback(() => {
    if (mode === "tooltip") {
      // 延迟 1s 隐藏，让用户有时间点击升级按钮
      setTimeout(() => {
        setShowTooltip(false);
      }, 1000);
    }
  }, [mode]);

  // 点击处理
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!canUse) {
        e.stopPropagation();
        e.preventDefault();
        if (mode === "dialog") {
          checkVersionPermission({
            module,
            count,
            content: content || t("version.not_support"),
            mode: "dialog",
          });
        }
        return;
      }
      onClick?.();
    },
    [canUse, mode, module, count, content, onClick],
  );

  // remove 模式：不满足直接返回 fallback
  if (mode === "remove" && !canUse) {
    return <>{fallback}</>;
  }

  // tooltip 模式：包装 Tooltip
  if (mode === "tooltip" && !canUse) {
    return (
      <Tooltip
        title={<UpgradeTooltipContent content={content} />}
        open={showTooltip}
        placement={placement}
        color={effect === "dark" ? "#1f1f1f" : "#fff"}
      >
        <div
          ref={childRef as any}
          style={{ cursor: "not-allowed", opacity: 0.5 }}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {children}
        </div>
      </Tooltip>
    );
  }

  // dialog 模式或版本通过：渲染 children
  // 如果版本不满足且是 dialog 模式，需要拦截点击
  if (!canUse && mode === "dialog") {
    return (
      <span onClick={handleClick} style={{ display: "contents" }}>
        {children}
      </span>
    );
  }

  return <>{children}</>;
}
