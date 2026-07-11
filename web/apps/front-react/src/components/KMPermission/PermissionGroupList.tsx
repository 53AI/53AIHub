import React, { useState } from 'react';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import PermissionSelector from './PermissionSelector';
import { PERMISSION_TYPE, RESOURCE_TYPE, ResourceType } from './constant';

interface GroupValue {
  permission: number;
  subject_id: number;
  subject_type: number;
}

interface Member {
  subject_id: number;
  subject_type: number;
  permission: number;
  [key: string]: any;
}

interface PermissionGroupListProps {
  title: string;
  resourceType?: ResourceType;
  value: GroupValue;
  userList?: Member[];
  disabled?: boolean;
  onChange?: (value: GroupValue) => void;
}

const SUBJECT_TYPE = {
  user: 0,
  group: 1,
  company_all: 2,
  space_admin: 3,
  space_user: 4,
  library_admin: 5,
  library_user: 6,
  space_active: 7,
} as const;

const PermissionGroupList: React.FC<PermissionGroupListProps> = ({
  title,
  resourceType = RESOURCE_TYPE.space,
  value,
  userList = [],
  disabled = false,
  onChange
}) => {
  const [isShowUserList, setIsShowUserList] = useState(false);

  const handleShowUserList = () => {
    setIsShowUserList(!isShowUserList);
  };

  const handleUpdatePermission = (permission: number) => {
    onChange?.({ ...value, permission });
  };

  return (
    <div>
      <div className="flex py-1 items-center justify-between">
        <div
          className="flex-1 flex items-center gap-2 cursor-pointer"
          onClick={handleShowUserList}
        >
          {isShowUserList ? <UpOutlined style={{ fontSize: 12, color: '#999999' }} /> : <DownOutlined style={{ fontSize: 12, color: '#999999' }} />}
          <span className="text-sm text-[#1D1E1F]">{title}</span>
        </div>
        <PermissionSelector
          disabled={disabled}
          resourceType={resourceType}
          value={value.permission}
          inherit
          none
          onChange={handleUpdatePermission}
        />
      </div>
      {/* 已选成员列表 */}
      {userList.length > 0 && isShowUserList && (
        <div className="pl-5">
          {userList.map((member) => (
            <div
              key={member.subject_id}
              className="flex items-center justify-between rounded-md px-0.5 py-1.5"
            >
              <div className="flex items-center gap-2">
                {member.subject_type === SUBJECT_TYPE.company_all ? (
                  <>
                    <img
                      src={window.$getPublicPath?.('/images/space/group.png') || '/images/space/group.png'}
                      alt="admin"
                      className="size-5"
                    />
                    <span className="text-sm text-[#1D1E1F]">所有成员</span>
                  </>
                ) : (
                  // EntityDisplay would need to be imported and used here
                  <span className="text-sm text-gray-600">
                    {/* EntityDisplay component would go here */}
                    Member {member.subject_id}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <PermissionSelector
                  resourceType={resourceType}
                  value={value.permission === PERMISSION_TYPE.inherit ? member.permission : value.permission}
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
};

export default PermissionGroupList;