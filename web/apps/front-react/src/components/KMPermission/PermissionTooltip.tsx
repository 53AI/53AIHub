import React, { useMemo } from 'react';
import { Tooltip, Button } from 'antd';
import { WarningFilled } from '@ant-design/icons';
import { eventBus } from '@km/shared-utils';
import { checkKMPermission } from '@/utils/km-permission';
import { PERMISSION_TYPE, PermissionType, ResourceType, RESOURCE_TYPE } from './constant';

interface PermissionTooltipProps {
  resource: {
    icon: any;
    name: any;
    [key: string]: any;
  };
  permission: PermissionType;
  required: PermissionType;
  resourceType?: ResourceType;
  placement?: 'top' | 'left' | 'right' | 'bottom' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'leftTop' | 'leftBottom' | 'rightTop' | 'rightBottom';
  inline?: boolean;
  appendTo?: string;
  children?: React.ReactNode;
}

const PermissionTooltip: React.FC<PermissionTooltipProps> = ({
  resource = { icon: '', name: '' },
  permission = 0,
  required = PERMISSION_TYPE.public_only,
  resourceType = RESOURCE_TYPE.library,
  placement = 'top',
  inline = true,
  appendTo,
  children
}) => {
  const stats = useMemo(() => checkKMPermission(permission, required), [permission, required]);

  const handleApply = () => {
    eventBus.emit('apply-open', {
      permission: required,
      resource: resource,
      resourceType: resourceType,
    });
  };

  const tooltipContent = (
    <div className="flex items-center gap-1">
      <WarningFilled style={{ color: '#F0A105', fontSize: 16 }} />
      <div className="text-sm text-[#1D1E1F] whitespace-nowrap">
        {stats.message}
      </div>
      <Button type="link" size="small" onClick={handleApply}>
        申请
      </Button>
    </div>
  );

  return (
    <Tooltip
      title={tooltipContent}
      placement={placement}
      overlayClassName="!p-2.5 !border-none shadow"
      overlayStyle={{ background: '#fff' }}
      open={stats.hasPermission ? false : undefined}
    >
      <div
        className={`relative ${stats.hasPermission ? '' : 'opacity-50'} ${inline ? 'inline-block' : 'block'}`}
      >
        {!stats.hasPermission && (
          <div className="absolute w-full h-full cursor-not-allowed z-[2]" />
        )}
        {children}
      </div>
    </Tooltip>
  );
};

export default PermissionTooltip;