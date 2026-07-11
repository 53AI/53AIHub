import React from 'react'
import { Tag } from 'antd'

export interface AuthTagGroupProps {
  value?: number[]
  className?: string
}

export const AuthTagGroup: React.FC<AuthTagGroupProps> = ({
  value = [],
  className
}) => {
  return (
    <div className={className}>
      {value.map((id) => (
        <Tag key={id} color="blue">
          Group {id}
        </Tag>
      ))}
    </div>
  )
}

export default AuthTagGroup
