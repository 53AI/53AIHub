import { ReactNode } from 'react'
import './empty.css'

interface PermissionEmptyProps {
  desc?: string
  className?: string
  children?: ReactNode
}

export function PermissionEmpty({
  desc = '很抱歉，你没有权限访问该页面',
  className = '',
  children
}: PermissionEmptyProps) {
  const getPublicPath = (path: string) => {
    if (typeof window !== 'undefined' && (window as any).$getPublicPath) {
      return (window as any).$getPublicPath(path)
    }
    return path
  }

  return (
    <div className={`flex flex-col items-center justify-center gap-4 ${className}`}>
      <img
        src={getPublicPath('/images/permission_empty.png')}
        alt="permission-empty"
        className="size-40"
      />
      {desc && (
        <p className="text-base text-[#939499]">{desc}</p>
      )}
      {children}
    </div>
  )
}

export default PermissionEmpty