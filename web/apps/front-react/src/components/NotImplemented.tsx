import React from 'react'
import { useLocation } from 'react-router-dom'

interface NotImplementedProps {
  name?: string
}

export const NotImplemented: React.FC<NotImplementedProps> = ({ name }) => {
  const location = useLocation()
  return (
    <div className="h-full p-6">
      <div className="text-lg font-medium">页面未实现</div>
      <div className="mt-2 text-gray-500">{name || location.pathname}</div>
    </div>
  )
}

export default NotImplemented
