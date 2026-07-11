import { ReactNode, useMemo } from "react";
import { Tooltip, Button } from "antd";
import { WarningFilled } from "@ant-design/icons";
import {
  PERMISSION_TYPE,
  RESOURCE_TYPE,
  type PermissionType,
  type ResourceType,
} from "./constant";
import { checkKMPermission } from "@/utils/km-permission";
import { usePermissionApply } from "@/contexts/PermissionApplyContext";
import "./tooltip.css";

interface PermissionTooltipProps {
  resource?: {
    icon?: string;
    name?: string;
    [key: string]: any;
  };
  permission: PermissionType;
  required: PermissionType;
  resourceType?: ResourceType;
  placement?: "top" | "bottom" | "left" | "right";
  inline?: boolean;
  getPopupContainer?: () => HTMLElement;
  children?: ReactNode;
}

export function PermissionTooltip({
  resource = { icon: "", name: "" },
  permission,
  required = PERMISSION_TYPE.public_only,
  resourceType = RESOURCE_TYPE.library,
  placement = "top",
  inline = true,
  getPopupContainer,
  children,
}: PermissionTooltipProps) {
  const { openApply } = usePermissionApply();
  const stats = useMemo(
    () => checkKMPermission(permission, required),
    [permission, required],
  );

  const handleApply = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    openApply({
      permission: required,
      resource,
      resourceType,
    });
  };

  const content = (
    <div className="permission-tooltip-content">
      <WarningFilled style={{ color: "#F0A105", fontSize: 16 }} />
      <div className="permission-tooltip-message">{stats.message}</div>
      <Button type="link" onClick={handleApply}>
        申请
      </Button>
    </div>
  );

  return (
    <Tooltip
      title={stats.hasPermission ? null : content}
      placement={placement}
      color="#fff"
      classNames={{ root: "permission-tooltip-overlay" }}
      getPopupContainer={getPopupContainer}
    >
      <div
        className={`permission-tooltip-wrapper ${stats.hasPermission ? "" : "opacity-50"} ${
          inline ? "inline-block" : "block"
        }`}
      >
        {!stats.hasPermission && (
          <div
            className="permission-tooltip-overlay-block"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          />
        )}
        {children}
      </div>
    </Tooltip>
  );
}

export default PermissionTooltip;
