import React, { useMemo, useRef } from 'react';
import { Button, Popover } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { PERMISSION_TYPE, PermissionType, RESOURCE_TYPE, ResourceType } from './constant';

interface RoleItem {
  title: string;
  value: PermissionType;
  desc?: string;
  color?: string;
}

interface PermissionSelectorProps {
  value: string | number;
  resourceType?: ResourceType;
  link?: boolean;
  type?: 'default' | 'primary' | 'dashed' | 'link' | 'text';
  inherit?: boolean;
  none?: boolean;
  remove?: boolean;
  disabled?: boolean;
  teleported?: boolean;
  appendTo?: string | HTMLElement;
  onChange?: (value: PermissionType) => void;
  onSelect?: (value: PermissionType) => void;
}

const PermissionSelector: React.FC<PermissionSelectorProps> = ({
  value,
  resourceType = RESOURCE_TYPE.space,
  link = true,
  type = 'default',
  inherit = false,
  none = false,
  remove = false,
  disabled = false,
  teleported = true,
  appendTo = 'body',
  onChange,
  onSelect
}) => {
  const popoverRef = useRef<any>(null);

  const roleOptions: RoleItem[] = useMemo(() => {
    let options: RoleItem[] = [
      {
        title: resourceType === RESOURCE_TYPE.space ? '继承团队空间权限' : '继承上级权限',
        desc: resourceType === RESOURCE_TYPE.space ? '继承团队空间权限' : '继承上级权限',
        value: PERMISSION_TYPE.inherit,
        color: '',
      },
      { title: '可管理', desc: '可编辑/下载/导出，添加成员', value: PERMISSION_TYPE.manage },
      { title: '可编辑知识&语料', desc: '可编辑知识和语料', value: PERMISSION_TYPE.edit_all },
      { title: '可编辑知识', desc: '编辑知识，不可编辑语料', value: PERMISSION_TYPE.edit_knowledge },
      { title: '可查看/导出', desc: '可查看及下载导出', value: PERMISSION_TYPE.view_and_export },
      { title: '仅查看', desc: '仅查看，不可下载导出', value: PERMISSION_TYPE.viewer },
      { title: '无权限', desc: '无权限，不可见', value: PERMISSION_TYPE.none, color: '' },
      { title: '移除', value: PERMISSION_TYPE.remove, color: '' },
    ];

    if (!inherit) {
      options = options.filter(o => o.value !== PERMISSION_TYPE.inherit);
    }
    if (!none) {
      options = options.filter(o => o.value !== PERMISSION_TYPE.none);
    }
    if (!remove) {
      options = options.filter(o => o.value !== PERMISSION_TYPE.remove);
    }

    const removeOption = options.find(o => o.value === PERMISSION_TYPE.remove);
    const noneOption = options.find(o => o.value === PERMISSION_TYPE.none);

    if (removeOption) {
      removeOption.color = '#FA5151';
    } else if (noneOption) {
      noneOption.color = '#FA5151';
    }

    return options;
  }, [resourceType, inherit, none, remove]);

  const displayLabel = useMemo(() => {
    return roleOptions.find(o => o.value === value)?.title || '';
  }, [roleOptions, value]);

  const handleSelect = (selectedValue: PermissionType) => {
    onChange?.(selectedValue);
    onSelect?.(selectedValue);
    popoverRef.current?.hide?.();
  };

  const content = (
    <div className="flex flex-col gap-0.5 px-1 py-1.5">
      {roleOptions.map((opt) => (
        <React.Fragment key={opt.value}>
          {opt.color && <div className="border-t my-1" />}
          <button
            type="button"
            className={`relative px-3 py-2 rounded hover:bg-[#2563EB14] text-left ${
              value === opt.value ? 'bg-[#2563EB14]' : ''
            }`}
            onClick={() => handleSelect(opt.value)}
          >
            {value === opt.value && (
              <div className="absolute top-1/2 left-0 -translate-y-1/2 w-1 h-4 rounded-full bg-[#2563EB]" />
            )}
            <div
              className="text-sm"
              style={{ color: opt.color || '#1D1E1F' }}
            >
              {opt.title}
            </div>
            {opt.desc && <div className="text-xs text-[#939499]">{opt.desc}</div>}
          </button>
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <Popover
      ref={popoverRef}
      placement="rightEnd"
      trigger="click"
      content={content}
      overlayClassName="!p-0"
      overlayStyle={{ width: 260 }}
    >
      <Button type={link ? 'link' : type} disabled={disabled}>
        <span className="text-sm">{displayLabel}</span>
        {!disabled && <DownOutlined className="ml-1" />}
      </Button>
    </Popover>
  );
};

export default PermissionSelector;