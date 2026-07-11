import { useMemo, useState } from "react";
import { Popover, Button } from "antd";
import { DownOutlined } from "@ant-design/icons";
import {
  PERMISSION_TYPE,
  RESOURCE_TYPE,
  type PermissionType,
  type ResourceType,
} from "./constant";
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
    let options: RoleOption[] = [
      {
        title:
          resourceType === RESOURCE_TYPE.space
            ? "继承团队空间权限"
            : "继承上级权限",
        desc:
          resourceType === RESOURCE_TYPE.space
            ? "继承团队空间权限"
            : "继承上级权限",
        value: PERMISSION_TYPE.inherit,
      },
      {
        title: "可管理",
        desc: "可编辑/下载/导出，添加成员",
        value: PERMISSION_TYPE.manage,
      },
      {
        title: "可编辑知识&语料",
        desc: "可编辑知识和语料",
        value: PERMISSION_TYPE.edit_all,
      },
      {
        title: "可编辑知识",
        desc: "编辑知识，不可编辑语料",
        value: PERMISSION_TYPE.edit_knowledge,
      },
      {
        title: "可查看/导出",
        desc: "可查看及下载导出",
        value: PERMISSION_TYPE.view_and_export,
      },
      {
        title: "仅查看",
        desc: "仅查看，不可下载导出",
        value: PERMISSION_TYPE.viewer,
      },
      { title: "无权限", desc: "无权限，不可见", value: PERMISSION_TYPE.none },
      { title: "移除", value: PERMISSION_TYPE.remove },
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
