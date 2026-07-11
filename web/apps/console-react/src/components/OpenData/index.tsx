import { useMemo } from 'react'

type OpenDataType = 'userName' | 'memberName' | 'wxUserName' | 'departmentName'

export interface OpenDataProps {
  source?: string
  type: OpenDataType
  openid?: string
  text?: string
  prefix?: React.ReactNode
  suffix?: React.ReactNode
}

export function OpenData({
  source = 'default',
  type,
  openid = '',
  text = '',
  prefix,
  suffix,
}: OpenDataProps) {
  // Parse openid values
  const values = useMemo(() => {
    if (!openid) return []
    const list = openid.split(',')
    return type === 'departmentName' ? list.filter((item) => +item > 0) : list
  }, [openid, type])

  // Default: render text
  return (
    <span ref={containerRef}>
      {prefix}
      {text}
      {suffix}
    </span>
  )
}

export default OpenData