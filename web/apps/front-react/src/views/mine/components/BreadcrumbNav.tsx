import { Breadcrumb } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import type { BreadcrumbItem } from '../types'

export interface BreadcrumbNavProps {
  items: BreadcrumbItem[]
  onItemClick?: (index: number) => void
}

/**
 * 面包屑导航组件
 */
export function BreadcrumbNav({ items, onItemClick }: BreadcrumbNavProps) {
  if (items.length <= 1) return null

  return (
    <div className="mt-4 flex items-center">
      <Breadcrumb
        separator={<SvgIcon name="arrow-right" classname="pt-1" size={14} />}
        items={items.map((item, index) => ({
          title: (
            <span
              className={`cursor-pointer ${index === items.length - 1 ? 'text-[#1D1E1F]' : 'hover:text-[#2563EB]'}`}
              onClick={() => index < items.length - 1 && onItemClick?.(index)}
            >
              {item.name}
            </span>
          ),
        }))}
      />
    </div>
  )
}

export default BreadcrumbNav
