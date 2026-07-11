import { createRoot } from "react-dom/client";
import { Modal, Tooltip, Button } from "antd";
import { WarningFilled } from "@ant-design/icons";
import { ServiceDialog } from "@/components/ServiceDialog";
import { useEnterpriseStore } from "@/stores";
import type { VersionModule } from "@/constants/enterprise";
import { VERSION_MODULE } from "@/constants/enterprise";

export const WEBSITE_VERSION = {
  FREE: 1,
  STANDARD: 2,
  ENTERPRISE: 3,
  FLAGSHIP: 4,
} as const;

let serviceMountNode: HTMLElement | null = null;
let serviceRoot: ReturnType<typeof createRoot> | null = null;

export type VersionOptions = {
  module: VersionModule;
  count?: number;
  content: string;
  mode?: "dialog" | "tooltip" | "remove";
  effect?: "dark" | "light";
  placement?:
    | "top"
    | "top-start"
    | "top-end"
    | "bottom"
    | "bottom-start"
    | "bottom-end"
    | "left"
    | "left-start"
    | "left-end"
    | "right"
    | "right-start"
    | "right-end";
  onClick?: () => void;
};

const t = (key: string) =>
  typeof window !== "undefined" && (window as any).$t
    ? (window as any).$t(key)
    : key;

/**
 * 显示服务弹窗
 */
const showServiceDialog = () => {
  if (serviceMountNode) {
    serviceMountNode.remove();
    serviceMountNode = null;
    serviceRoot?.unmount();
    serviceRoot = null;
  }

  serviceMountNode = document.createElement("div");
  document.body.appendChild(serviceMountNode);

  serviceRoot = createRoot(serviceMountNode);
  serviceRoot.render(
    <ServiceDialog
      open={true}
      title={t("version.scan_consult")}
      onClose={() => {
        if (serviceMountNode) {
          setTimeout(() => {
            serviceMountNode?.remove();
            serviceMountNode = null;
            serviceRoot?.unmount();
            serviceRoot = null;
          }, 300);
        }
      }}
    />,
  );
};

/**
 * 显示升级提示弹窗
 * @param content 提示内容
 */
const showUpgradeDialog = (content: string) => {
  Modal.confirm({
    title: t("version.upgrade_tip"),
    content,
    okText: t("action_upgrade"),
    cancelText: t("action_cancel"),
    type: "warning",
    centered: true,
    className: "version-upgrade-dialog",
    style: {
      padding: 0,
    },
    onOk: () => {
      showServiceDialog();
    },
    onCancel: () => {
      console.log("用户取消了升级");
    },
  });
};

/**
 * 创建带有升级按钮的 tooltip 内容
 */
const createTooltipContent = (content?: string) => {
  const baseText = content || t("version.not_support");

  return (
    <div className="version-tooltip-content flex items-center gap-2">
      <WarningFilled style={{ color: "#F0A105", fontSize: 16 }} />
      <div>{baseText}</div>
      <Button type="link" size="small" onClick={() => showServiceDialog()}>
        {t("version.upgrade")}
      </Button>
    </div>
  );
};

interface VersionTooltipInstance {
  mountNode: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
  destroy: () => void;
}

declare global {
  interface HTMLElement {
    _versionTooltip?: VersionTooltipInstance;
  }
}

/**
 * 显示版本限制 tooltip
 * @param el 目标元素
 * @param content 提示内容
 * @param options tooltip 选项
 */
const showVersionTooltip = (
  el: HTMLElement,
  content: string,
  options: { effect?: string; placement?: string } = {},
) => {
  // 已存在就不创建
  if (el._versionTooltip) return;

  // 挂载到元素
  const mountNode = document.createElement("div");
  mountNode.style.cssText =
    "position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: auto; z-index: 99;";

  // 确保元素有相对定位
  if (getComputedStyle(el).position === "static") {
    el.style.position = "relative";
  }

  const placementMap: Record<
    string,
    | "top"
    | "left"
    | "right"
    | "bottom"
    | "topLeft"
    | "topRight"
    | "bottomLeft"
    | "bottomRight"
    | "leftTop"
    | "leftBottom"
    | "rightTop"
    | "rightBottom"
  > = {
    top: "top",
    "top-start": "topLeft",
    "top-end": "topRight",
    bottom: "bottom",
    "bottom-start": "bottomLeft",
    "bottom-end": "bottomRight",
    left: "left",
    "left-start": "leftTop",
    "left-end": "leftBottom",
    right: "right",
    "right-start": "rightTop",
    "right-end": "rightBottom",
  };

  const placement = placementMap[options.placement || "top-end"] || "topRight";

  const root = createRoot(mountNode);
  root.render(
    <Tooltip
      placement={placement}
      color={options.effect === "dark" ? "#1f1f1f" : "#fff"}
      open={true}
      title={createTooltipContent(content)}
    >
      <span
        style={{ display: "inline-block", width: "100%", height: "100%" }}
      />
    </Tooltip>,
  );

  el.appendChild(mountNode);

  // 保存引用以便清理
  el._versionTooltip = {
    mountNode,
    root,
    destroy: () => {
      root.unmount();
      if (mountNode.parentNode) {
        mountNode.parentNode.removeChild(mountNode);
      }
    },
  };
};

/**
 * 检查版本权限
 * @param module 模块
 * @param count 数量
 * @returns boolean 是否满足版本要求
 */
export const checkVersion = (module: string, count?: number) => {
  const enterpriseStore = useEnterpriseStore.getState();
  const features = enterpriseStore.version.features;
  if (module in features) {
    const feature = features[module];
    // 功能禁用
    if (feature.max === 0) return false;
    // 不限数量
    if (feature.max === -1) return true;
    return feature.max > (count || 0);
  }
  return true;
};

/**
 * 统一的版本权限检查函数
 * @param options 版本检查选项
 * @param el 目标元素（tooltip 模式时需要）
 * @returns boolean 是否通过版本检查
 */
export const checkVersionPermission = (
  options: VersionOptions,
  el?: HTMLElement,
) => {
  const {
    module,
    count,
    content,
    mode = "dialog",
    effect,
    placement,
    onClick,
  } = options;

  if (!checkVersion(module, count)) {
    if (mode === "tooltip" && el) {
      // 显示 tooltip 提示
      showVersionTooltip(el, content, { effect, placement });
    } else {
      // 显示升级提示弹窗
      showUpgradeDialog(
        typeof content === "string" ? content : t("version.not_support"),
      );
    }
    return false;
  }

  // 如果版本检查通过，执行回调
  if (onClick) {
    onClick();
  }

  return true;
};

/**
 * 导出 tooltip 相关函数供外部使用
 */
export { showVersionTooltip, showServiceDialog, showUpgradeDialog };

export { VERSION_MODULE };
