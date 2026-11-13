import { useMemo } from 'react'

type OpenDataType = 'userName' | 'memberName' | 'wxUserName' | 'departmentName'

export interface OpenDataProps {
  source?: string
  type: OpenDataType
  /** 后端可能返回数字类型的 ID（钉钉 userid 等），内部会统一转字符串处理 */
  openid?: string | number
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
    // 后端可能返回数字类型的 bind_value（如钉钉 userid），统一转字符串再拆分，避免 "split is not a function"
    const list = String(openid).split(',')
    return type === 'departmentName' ? list.filter((item) => +item > 0) : list
  }, [openid, type])

  // Default: render text
  return (
    <span >
      {prefix}
      {text}
      {suffix}
    </span>
  )
}

export default OpenData