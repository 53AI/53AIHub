import React, { useState, useEffect } from "react";
import { Tag, Button, message } from "antd";
import { Dropdown } from "@km/shared-components-react";
import { DownOutlined } from "@ant-design/icons";
import { t } from "@/locales";
import type { InternalUserStatus } from "@/api/modules/user";
import {
  INTERNAL_USER_STATUS_DISABLED,
  INTERNAL_USER_STATUS_ENABLED,
  INTERNAL_USER_STATUS_LABEL_MAP,
  INTERNAL_USER_STATUS_UNDEFINED,
  userApi,
} from "@/api/modules/user";

interface UserInternalStatusProps {
  value?: InternalUserStatus;
  onChange?: (value: InternalUserStatus) => void;
  actionDisabled?: boolean;
  buttonDisabled?: boolean;
  userData?: any;
  buttonClass?: string;
  size?: "small" | "middle" | "large";
}

const TAG_TYPE_MAP = new Map<InternalUserStatus, string>([
  [INTERNAL_USER_STATUS_UNDEFINED, "default"],
  [INTERNAL_USER_STATUS_ENABLED, "success"],
  [INTERNAL_USER_STATUS_DISABLED, "error"],
]);

const UserInternalStatus: React.FC<UserInternalStatusProps> = ({
  value = INTERNAL_USER_STATUS_UNDEFINED,
  onChange,
  actionDisabled = false,
  buttonDisabled = false,
  userData = {},
  buttonClass = "",
  size = "middle",
}) => {
  const [currentValue, setCurrentValue] = useState<InternalUserStatus>(value);

  useEffect(() => {
    setCurrentValue(value);
  }, [value]);

  const handleStatusChange = async (key: string) => {
    const newVal = Number(key) as InternalUserStatus;
    if (!actionDisabled) {
      try {
        await userApi.update_user_status({
          user_id: userData.user_id,
          status: newVal,
        });
        message.success(t("action_save_success"));
      } catch (error) {
        console.error(error);
        return;
      }
    }
    setCurrentValue(newVal);
    onChange?.(newVal);
  };

  const items = [
    {
      key:
        currentValue === INTERNAL_USER_STATUS_ENABLED
          ? String(INTERNAL_USER_STATUS_DISABLED)
          : String(INTERNAL_USER_STATUS_ENABLED),
      label: t(
        currentValue === INTERNAL_USER_STATUS_ENABLED
          ? "internal_user.action.disabled"
          : "internal_user.action.enable",
      ),
    },
  ];

  const labelKey = INTERNAL_USER_STATUS_LABEL_MAP.get(currentValue) || "";
  const tagColor = TAG_TYPE_MAP.get(currentValue) || "default";

  return (
    <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
      <Tag
        color={tagColor}
        className={
          currentValue === INTERNAL_USER_STATUS_UNDEFINED
            ? "bg-transparent"
            : ""
        }
      >
        {t(labelKey)}
      </Tag>
      {[INTERNAL_USER_STATUS_ENABLED, INTERNAL_USER_STATUS_DISABLED].includes(
        currentValue,
      ) && (
        <Dropdown
          menu={{ items, onClick: (info) => handleStatusChange(info.key) }}
          trigger={buttonDisabled ? [] : ["click"]}
        >
          <Button
            size={size === "middle" ? "small" : size}
            icon={<DownOutlined />}
            className={`!px-2 ml-2 ${buttonClass}`}
            disabled={buttonDisabled}
          />
        </Dropdown>
      )}
    </div>
  );
};

export default UserInternalStatus;
