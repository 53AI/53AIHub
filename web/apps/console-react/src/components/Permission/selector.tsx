import { Button } from 'antd'
import { Dropdown } from '@km/shared-components-react'
import { DownOutlined } from '@ant-design/icons'
import { useMemo } from 'react'
import { PERMISSION_TYPE, RESOURCE_TYPE, type PermissionType, type ResourceType } from './constant'

export interface PermissionSelectorProps {
  value?: string | number
  onChange?: (value: PermissionType) => void
  onSelect?: (value: PermissionType) => void
  resourceType?: ResourceType
  link?: boolean
  buttonType?: 'default' | 'primary' | 'dashed' | 'link' | 'text'
  inherit?: boolean
  none?: boolean
  remove?: boolean
  disabled?: boolean
  /** 是否将弹出层传送至 body，默认 true */
  teleported?: boolean
  /** 弹出层挂载位置 */
  appendTo?: string | HTMLElement
}

interface RoleItem {
  title: string
  value: PermissionType
  desc?: string
  color?: string
}

export function PermissionSelector({
  value = '',
  onChange,
  onSelect,
  resourceType = RESOURCE_TYPE.space,
  link = true,
  buttonType = 'default',
  inherit = false,
  none = false,
  remove = false,
  disabled = false,
  teleported = true,
  appendTo = 'body',
}: PermissionSelectorProps) {
  // Role options
  const roleOptions = useMemo(() => {
    let options: RoleItem[] = [
      {
        title: resourceType === RESOURCE_TYPE.space ? '继承空间管理权限' : '继承上级权限',
        desc: resourceType === RESOURCE_TYPE.space ? '继承空间管理权限' : '继承上级权限',
        value: PERMISSION_TYPE.inherit,
      },
      { title: '可管理', desc: '可编辑/下载/导出，添加成员', value: PERMISSION_TYPE.manage },
      { title: '可编辑知识&语料', desc: '可编辑知识和语料', value: PERMISSION_TYPE.edit_all },
      { title: '可编辑知识', desc: '编辑知识，不可编辑语料', value: PERMISSION_TYPE.edit_knowledge },
      { title: '可查看/导出', desc: '可查看及下载导出', value: PERMISSION_TYPE.view_and_export },
      { title: '仅查看', desc: '仅查看，不可下载导出', value: PERMISSION_TYPE.viewer },
      { title: '无权限', desc: '无权限，不可见', value: PERMISSION_TYPE.none },
      { title: '移除', value: PERMISSION_TYPE.remove },
    ]

    if (!inherit) {
      options = options.filter((o) => o.value !== PERMISSION_TYPE.inherit)
    }
    if (!none) {
      options = options.filter((o) => o.value !== PERMISSION_TYPE.none)
    }
    if (!remove) {
      options = options.filter((o) => o.value !== PERMISSION_TYPE.remove)
    }

    // Set color for remove/none options
    const removeOption = options.find((o) => o.value === PERMISSION_TYPE.remove)
    const noneOption = options.find((o) => o.value === PERMISSION_TYPE.none)

    if (removeOption) {
      removeOption.color = '#FA5151'
    } else if (noneOption) {
      noneOption.color = '#FA5151'
    }

    return options
  }, [resourceType, inherit, none, remove])

  // Display label
  const displayLabel = useMemo(() => {
    return roleOptions.find((o) => o.value === value)?.title || ''
  }, [roleOptions, value])

  // Handle select
  const handleSelect = (item: RoleItem) => {
    onChange?.(item.value)
    onSelect?.(item.value)
  }

  // Dropdown menu items
  const menuItems = useMemo(() => {
    const items: any[] = []

    roleOptions.forEach((opt, index) => {
      if (opt.color) {
        items.push({ type: 'divider', key: `divider-${index}` })
      }
      items.push({
        key: opt.value.toString(),
        label: (
          <div
            className={`relative px-3 py-2 rounded hover:bg-[#2563EB14] text-left ${
              value === opt.value ? 'bg-[#2563EB14]' : ''
            }`}
          >
            {/* 左侧选中指示条 */}
            {value === opt.value && (
              <div className="absolute top-1/2 left-0 -translate-y-1/2 w-1 h-4 rounded-full bg-[#2563EB]" />
            )}
            <div
              className="text-sm"
              style={{ color: opt.color || '#1D1E1F' }}
            >
              {opt.title}
            </div>
            {opt.desc && <div className="text-xs text-hint">{opt.desc}</div>}
          </div>
        ),
        onClick: () => handleSelect(opt),
      })
    })

    return items
  }, [roleOptions, value])

  // 获取 getPopupContainer 配置
  const getPopupContainer = useMemo(() => {
    if (!teleported) {
      return (triggerNode: HTMLElement) => triggerNode.parentNode as HTMLElement
    }
    if (typeof appendTo === 'string') {
      return () => document.querySelector(appendTo) || document.body
    }
    if (appendTo instanceof HTMLElement) {
      return () => appendTo
    }
    return undefined
  }, [teleported, appendTo])

  return (
    <Dropdown
      menu={{ items: menuItems }}
      disabled={disabled}
      trigger={['click']}
      placement="bottomRight"
      getPopupContainer={getPopupContainer}
    >
      <Button type={link ? 'link' : buttonType} disabled={disabled}>
        <span className="text-sm">{displayLabel}</span>
        {!disabled && <DownOutlined className="ml-1" />}
      </Button>
    </Dropdown>
  )
}

export default PermissionSelector
