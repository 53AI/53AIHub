import { useState } from "react";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { RolePopover } from "./RolePopover";
import { EntityDisplay } from "@/components/EntityDisplay";
import {
  PERMISSION_TYPE,
  SUBJECT_TYPE,
  RESOURCE_TYPE,
  type ResourceType,
} from "./constant";
import { getPublicPath } from "@/utils/config";
import "./group-list.css";

interface GroupMember {
  subject_id: number;
  subject_type: number;
  permission: number;
}

interface GroupListValue {
  permission: number;
  subject_id: number;
  subject_type: number;
}

interface GroupListProps {
  title: string;
  resourceType?: ResourceType;
  value: GroupListValue;
  userList?: GroupMember[];
  disabled?: boolean;
  onChange?: (value: GroupListValue) => void;
}

export function GroupList({
  title,
  resourceType = RESOURCE_TYPE.space,
  value,
  userList = [],
  disabled = false,
  onChange,
}: GroupListProps) {
  const [isShowUserList, setIsShowUserList] = useState(false);

  const handleShowUserList = () => {
    setIsShowUserList(!isShowUserList);
  };

  const handleUpdatePermission = (permission: number) => {
    onChange?.({ ...value, permission });
  };

  return (
    <div className="km-group-list">
      <div className="km-group-list-header">
        <div className="km-group-list-title" onClick={handleShowUserList}>
          {isShowUserList ? (
            <UpOutlined style={{ fontSize: 12, color: "#999999" }} />
          ) : (
            <DownOutlined style={{ fontSize: 12, color: "#999999" }} />
          )}
          <span className="km-group-list-title-text">{title}</span>
        </div>
        <RolePopover
          value={value.permission}
          onChange={handleUpdatePermission}
          resourceType={resourceType}
          disabled={disabled}
          inherit
          none
        />
      </div>
      {userList.length > 0 && isShowUserList && (
        <div className="km-group-list-members">
          {userList.map((member) => (
            <div key={member.subject_id} className="km-group-list-member">
              <div className="km-group-list-member-info">
                {member.subject_type === SUBJECT_TYPE.company_all ? (
                  <>
                    <img
                      src={getPublicPath("/images/space/group.png")}
                      alt="admin"
                      className="km-group-list-member-icon"
                    />
                    <span className="km-group-list-member-name">所有成员</span>
                  </>
                ) : (
                  <EntityDisplay
                    id={member.subject_id}
                    mode="full"
                    type={
                      member.subject_type === SUBJECT_TYPE.user
                        ? "user"
                        : "group"
                    }
                  />
                )}
              </div>
              <div className="km-group-list-member-permission">
                <RolePopover
                  value={
                    value.permission === PERMISSION_TYPE.inherit
                      ? member.permission
                      : value.permission
                  }
                  resourceType={resourceType}
                  inherit
                  none
                  disabled
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default GroupList;
