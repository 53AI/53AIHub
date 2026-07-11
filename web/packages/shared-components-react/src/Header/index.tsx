import React from 'react'
import { Button } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'

export interface HeaderProps {
  title?: string
  sticky?: boolean
  back?: boolean
  onBack?: () => void
  children?: React.ReactNode
}

export const Header: React.FC<HeaderProps> = ({
  title,
  sticky = false,
  back = false,
  onBack,
  children
}) => {
  return (
    <header
      className={`flex items-center justify-between p-4 bg-white border-b ${
        sticky ? 'sticky top-0 z-10' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        {back && <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} />}
        {title && <h1 className="text-lg font-semibold">{title}</h1>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </header>
  )
}

export default Header
