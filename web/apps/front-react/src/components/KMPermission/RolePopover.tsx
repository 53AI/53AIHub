import { useMemo, useState } from "react";
import { Popover, Button } from "antd";
import { DownOutlined } from "@ant-design/icons";
import {
  PERMISSION_TYPE,
  RESOURCE_TYPE,
  type PermissionType,
  type ResourceType,
} from "./constant";
import { PERMISSION_LABEL, PERMISSION_DESC } from "./permission-label";
import "./RolePopover.css";

interface RoleOption {
  title: string;
  value: PermissionType;
  desc?: string;
  color?: string;
}

interface RolePopoverProps {
  value: PermissionType;
  onChange?: (value: PermissionType) => void;
  onSelect?: (value: PermissionType) => void;
  resourceType?: ResourceType;
  link?: boolean;
  type?: "default" | "primary" | "dashed" | "text" | "link";
  inherit?: boolean;
  none?: boolean;
  remove?: boolean;
  disabled?: boolean;
  getPopupContainer?: () => HTMLElement;
}

export function RolePopover({
  value,
  onChange,
  onSelect,
  resourceType = RESOURCE_TYPE.space,
  link = true,
  type = "default",
  inherit = false,
  none = false,
  remove = false,
  disabled = false,
  getPopupContainer,
}: RolePopoverProps) {
  const [open, setOpen] = useState(false);

  const roleOptions = useMemo<RoleOption[]>(() => {
    const inheritLabel =
      resourceType === RESOURCE_TYPE.space
        ? "继承团队空间权限"
        : PERMISSION_LABEL[PERMISSION_TYPE.inherit];
    let options: RoleOption[] = [
      {
        title: inheritLabel,
        desc: inheritLabel,
        value: PERMISSION_TYPE.inherit,
      },
      {
        title: PERMISSION_LABEL[PERMISSION_TYPE.manage],
        desc: PERMISSION_DESC[PERMISSION_TYPE.manage],
        value: PERMISSION_TYPE.manage,
      },
      {
        title: PERMISSION_LABEL[PERMISSION_TYPE.edit_all],
        desc: PERMISSION_DESC[PERMISSION_TYPE.edit_all],
        value: PERMISSION_TYPE.edit_all,
      },
      {
        title: PERMISSION_LABEL[PERMISSION_TYPE.edit_knowledge],
        desc: PERMISSION_DESC[PERMISSION_TYPE.edit_knowledge],
        value: PERMISSION_TYPE.edit_knowledge,
      },
      {
        title: PERMISSION_LABEL[PERMISSION_TYPE.view_and_export],
        desc: PERMISSION_DESC[PERMISSION_TYPE.view_and_export],
        value: PERMISSION_TYPE.view_and_export,
      },
      {
        title: PERMISSION_LABEL[PERMISSION_TYPE.viewer],
        desc: PERMISSION_DESC[PERMISSION_TYPE.viewer],
        value: PERMISSION_TYPE.viewer,
      },
      {
        title: PERMISSION_LABEL[PERMISSION_TYPE.none],
        desc: PERMISSION_DESC[PERMISSION_TYPE.none],
        value: PERMISSION_TYPE.none,
      },
      { title: PERMISSION_LABEL[PERMISSION_TYPE.remove], value: PERMISSION_TYPE.remove },
    ];

    if (!inherit) {
      options = options.filter((o) => o.value !== PERMISSION_TYPE.inherit);
    }
    if (!none) {
      options = options.filter((o) => o.value !== PERMISSION_TYPE.none);
    }
    if (!remove) {
      options = options.filter((o) => o.value !== PERMISSION_TYPE.remove);
    }
    if (resourceType === RESOURCE_TYPE.wiki_page) {
      options = options.filter((o) => o.value !== PERMISSION_TYPE.edit_all);
    }

    const removeOption = options.find(
      (o) => o.value === PERMISSION_TYPE.remove,
    );
    const noneOption = options.find((o) => o.value === PERMISSION_TYPE.none);

    if (removeOption) {
      removeOption.color = "#FA5151";
    } else if (noneOption) {
      noneOption.color = "#FA5151";
    }

    return options;
  }, [resourceType, inherit, none, remove]);

  const displayLabel = useMemo(() => {
    const option = roleOptions.find((o) => o.value === value);
    return option?.title || "";
  }, [roleOptions, value]);

  const handleSelect = (selectedValue: PermissionType) => {
    onChange?.(selectedValue);
    onSelect?.(selectedValue);
    setOpen(false);
  };

  const content = (
    <div className="role-popover-content">
      {roleOptions.map((opt, index) => (
        <div key={opt.value}>
          {opt.color && index > 0 && <div className="role-divider" />}
          <button
            type="button"
            className={`role-option ${value === opt.value ? "selected" : ""}`}
            onClick={() => handleSelect(opt.value)}
          >
            {value === opt.value && <div className="role-indicator" />}
            <div
              className="role-title"
              style={opt.color ? { color: opt.color } : undefined}
            >
              {opt.title}
            </div>
            {opt.desc && <div className="role-desc">{opt.desc}</div>}
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      content={content}
      trigger="click"
      placement="rightTop"
      classNames={{ root: "role-popover-overlay" }}
      getPopupContainer={getPopupContainer}
    >
      <Button
        type={link ? "link" : type}
        disabled={disabled}
        className="role-popover-trigger"
      >
        <span className="role-label">{displayLabel}</span>
        {!disabled && <DownOutlined className="role-arrow" />}
      </Button>
    </Popover>
  );
}

export default RolePopover;
