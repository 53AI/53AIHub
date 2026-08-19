import { Tooltip } from "antd";
import { Dropdown } from "@km/shared-components-react";
import type { MenuProps } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import "./index.css";
import React from "react";

export interface MenuItem {
  /** Command value */
  key: string | number;
  /** Icon name */
  icon?: string;
  /** Icon size */
  iconSize?: number | string;
  /** Icon class name */
  iconClass?: string;
  /** Label text */
  label?: string;
  /** Text class name */
  textClass?: string;
  /** Whether to show divider */
  divided?: boolean;
  /** Whether disabled */
  disabled?: boolean;
  /** Whether it's a dangerous action (red text) */
  danger?: boolean;
  /** Whether visible (for conditional rendering) */
  visible?: boolean;
  /** Optional wrapper function for the item content (e.g., permission tooltip) */
  wrapper?: (children: React.ReactNode) => React.ReactNode;
  /** Submenu items; when present, Antd renders this item as a hover submenu */
  children?: MenuItem[];
}

/** Recursively build Antd menu item shape from MenuItem, preserving submenu children. */
function buildAntdItem(item: MenuItem): NonNullable<MenuProps["items"]>[number] {
  if (item.divided) {
    return { type: "divider", key: item.key };
  }
  const labelContent = (
    <span className={`flex items-center`}>
      {item.icon && (
        <SvgIcon
          name={item.icon}
          size={item.iconSize || 16}
          className={`${item.iconClass ?? "menu-icon"}${item.danger ? " danger" : ""}`}
        />
      )}
      {item.label}
    </span>
  );
  return {
    key: item.key,
    label: item.wrapper ? item.wrapper(labelContent) : labelContent,
    disabled: item.disabled,
    danger: item.danger,
    children: item.children?.length
      ? item.children.map((c) => buildAntdItem(c))
      : undefined,
  };
}

interface MoreDropdownProps {
  /** Trigger button size */
  size?: string | number;
  /** Icon name */
  icon?: string;
  /** Icon size */
  iconSize?: number | string;
  /** Tooltip text */
  tooltip?: string;
  /** Dropdown trigger */
  trigger?: ("click" | "hover" | "contextMenu")[];
  /** Background color on hover */
  backgroundColor?: string;
  /** Trigger button class name */
  triggerClassName?: string;
  /** Menu items */
  items?: MenuItem[];
  /** Trigger element (replaces default trigger) */
  triggerElement?: React.ReactNode;
  /** Callback when menu item is clicked */
  onCommand?: (key: string | number) => void;
  /** Children for custom menu items */
  children?: React.ReactNode;
  /** Dropdown placement */
  placement?:
    | "bottom"
    | "bottomLeft"
    | "bottomRight"
    | "top"
    | "topLeft"
    | "topRight";
  /** Controlled open state */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Whether to unmount the dropdown when hidden (avoid perf issues when rendering many at once) */
  destroyOnHidden?: boolean;
}

export function MoreDropdown({
  size = "32px",
  icon = "more-two",
  iconSize = 18,
  tooltip = "更多",
  trigger = ["click"],
  backgroundColor = "#F2F6FE",
  triggerClassName = "",
  items = [],
  triggerElement,
  onCommand,
  children,
  placement,
  open,
  onOpenChange,
  destroyOnHidden,
}: MoreDropdownProps) {
  const menuItems: MenuProps["items"] = items
    .filter((item) => item.visible !== false)
    .map((item) => buildAntdItem(item));

  const handleClick: MenuProps["onClick"] = ({ key, domEvent }) => {
    domEvent.stopPropagation();
    onCommand?.(key);
  };

  const triggerButton = triggerElement || (
    <div
      className={`more-dropdown-trigger ${triggerClassName}`}
      style={
        {
          width: typeof size === "number" ? `${size}px` : size,
          height: typeof size === "number" ? `${size}px` : size,
          "--background-color": backgroundColor,
        } as React.CSSProperties
      }
      onClick={(e) => e.stopPropagation()}
    >
      <SvgIcon name={icon} size={iconSize} />
    </div>
  );

  const dropdown = (
    <Dropdown
      menu={{ items: menuItems, onClick: handleClick }}
      trigger={trigger}
      placement={placement}
      classNames={{ root: "more-dropdown-overlay" }}
      open={open}
      onOpenChange={onOpenChange}
      destroyOnHidden={destroyOnHidden}
    >
      {tooltip ? (
        <Tooltip title={tooltip}>{triggerButton}</Tooltip>
      ) : (
        <span>{triggerButton}</span>
      )}
    </Dropdown>
  );

  return dropdown;
}

export default MoreDropdown;
