import React from 'react';

interface PermissionEmptyProps {
  desc?: string;
  children?: React.ReactNode;
}

const PermissionEmpty: React.FC<PermissionEmptyProps> = ({
  desc = '很抱歉，你没有权限访问该页面',
  children
}) => {
  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <img
        src={window.$getPublicPath?.('/images/permission_empty.png') || '/images/permission_empty.png'}
        alt="permission-empty"
        className="size-40"
      />
      {desc && (
        <p className="text-base text-[#939499]">
          {desc}
        </p>
      )}
      {children}
    </div>
  );
};

export default PermissionEmpty;