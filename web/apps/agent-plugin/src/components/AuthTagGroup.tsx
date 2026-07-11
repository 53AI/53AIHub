import { useMemo, useState, useEffect } from 'react'
import { Skeleton, Divider } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import request from '../utils/request'

interface AuthTagGroupProps {
  value?: number[]
  label?: string
  labelPosition?: 'left' | 'top'
  hideLabel?: boolean
  emptyText?: string
}

interface SubscriptionItem {
  group_id: number
  group_name: string
  logo?: string
}

interface UserGroupItem {
  group_id: number
  group_name: string
}

const DEFAULT_LOGO = '/images/subscription/vip-0.png'

export function AuthTagGroup({
  value = [],
  label,
  labelPosition = 'left',
  hideLabel = false,
  emptyText = '--'
}: AuthTagGroupProps) {
  const [loading, setLoading] = useState(false)
  const [subscriptionList, setSubscriptionList] = useState<SubscriptionItem[]>([])
  const [userGroupList, setUserGroupList] = useState<UserGroupItem[]>([])

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [subRes, groupRes] = await Promise.all([
          request.get('/api/subscriptions/settings').then((res: any) => res?.data?.settings || []),
          // GROUP_TYPE.INTERNAL_USER = 4
          request.get('/api/groups/type/current/4').then((res: any) => res?.data || [])
        ])
        // Subscription 数据结构: {group: {group_id, group_name, ...}, setting: {logo_url, ...}}
        const subscriptionItems = subRes.map((item: any) => ({
          group_id: item.group?.group_id,
          group_name: item.group?.group_name,
          logo: item.setting?.logo_url || item.group?.logo || ''
        }))
        setSubscriptionList(subscriptionItems)
        setUserGroupList(groupRes)
      } catch (error) {
        console.error('Failed to fetch auth tag data:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const visibleSubscriptionItems = useMemo(() => {
    return subscriptionList.filter((item) => value.includes(item.group_id))
  }, [subscriptionList, value])

  const visibleUserGroupItems = useMemo(() => {
    return userGroupList.filter((item) => value.includes(item.group_id))
  }, [userGroupList, value])

  const hasVisibleItems = visibleSubscriptionItems.length > 0 || visibleUserGroupItems.length > 0

  const getLogoSrc = (item: SubscriptionItem) => {
    if (!value.includes(item.group_id)) {
      return DEFAULT_LOGO
    }
    return item.logo || DEFAULT_LOGO
  }

  if (loading) {
    return (
      <div className="flex items-center gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton.Button key={i} active size="small" style={{ width: 80, height: 24 }} />
        ))}
      </div>
    )
  }

  return (
    <ul className="flex flex-wrap items-center gap-4 auth-tag-group">
      {!hideLabel && (
        <label
          className={`inline-block text-sm text-gray-600 ${labelPosition === 'top' ? 'w-full -mb-1' : ''}`}
        >
          {label || '使用范围'}:
        </label>
      )}

      {!hasVisibleItems && (
        <span className="text-sm text-gray-400">{emptyText}</span>
      )}

      {/* Subscription groups */}
      {visibleSubscriptionItems.map((item) => (
        <li
          key={item.group_id}
          className="flex items-center gap-1 text-sm text-gray-800"
        >
          <img
            src={getLogoSrc(item)}
            className="flex-none w-6 h-6 rounded-full"
            alt={item.group_name}
          />
          {item.group_name}
        </li>
      ))}

      {/* Divider between subscription and user groups */}
      {visibleSubscriptionItems.length > 0 && visibleUserGroupItems.length > 0 && (
        <Divider key="divider" type="vertical" className="!mx-0" />
      )}

      {/* User groups */}
      {visibleUserGroupItems.map((item) => (
        <li
          key={item.group_id}
          className="flex items-center gap-1 text-sm text-gray-800"
        >
          <SvgIcon
            name="user-group"
            className="flex-none w-6 h-6 text-blue-500"
          />
          {item.group_name}
        </li>
      ))}
    </ul>
  )
}

export default AuthTagGroup