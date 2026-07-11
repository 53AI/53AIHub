import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Skeleton, Divider, Tooltip } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import type { ScopeItem } from '@km/shared-business/agent-create'
import { subscriptionApi } from '@/api/modules/subscription'
import groupApi from '@/api/modules/group'
import { departmentApi } from '@/api/modules/department'
import { userApi } from '@/api/modules/user'
import { useEnterpriseType } from '@/stores/modules/enterprise'
import { GROUP_TYPE } from '@/constants/group'
import { getPublicPath } from '@/utils/config'
import { t } from '@/locales'
import './index.css'

interface DisplayItem {
  id: number
  name: string
  type: 'subscription' | 'userGroup'
  logo?: string
}

interface TreeNode {
  value: number | string
  label: string
  did?: number
  user_id?: number
  children?: TreeNode[]
}

interface AuthTagGroupProps {
  value?: (string | number)[]
  label?: string
  labelPosition?: 'left' | 'top'
  hideLabel?: boolean
  emptyText?: string
  mode?: 'default' | 'compact'
  /** 可见范围 scopes，可选。传入时将展示权限范围标签 */
  scopes?: ScopeItem[]
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

// 内部用户全状态常量（与 api/modules/user 中一致）
const INTERNAL_USER_STATUS_ALL = -1

export function AuthTagGroup({
  value: valueProp,
  label,
  labelPosition = 'left',
  hideLabel = false,
  emptyText = '--',
  mode = 'default',
  scopes,
}: AuthTagGroupProps) {
  // 防御性处理：确保 value 始终是数组
  const value = Array.isArray(valueProp) ? valueProp : [];
  const { isIndependent, isEnterprise } = useEnterpriseType()
  const [loading, setLoading] = useState(false)
  const [subscriptionList, setSubscriptionList] = useState<SubscriptionItem[]>([])
  const [userGroupList, setUserGroupList] = useState<UserGroupItem[]>([])
  const [visibleCount, setVisibleCount] = useState<number | null>(null)
  const ulRef = useRef<HTMLUListElement>(null)
  const visibleUlRef = useRef<HTMLUListElement>(null)

  // scopes 相关
  const [scopeDeptTree, setScopeDeptTree] = useState<TreeNode[]>([])
  const [scopeUsers, setScopeUsers] = useState<TreeNode[]>([])
  const [scopeGroups, setScopeGroups] = useState<TreeNode[]>([])

  const labelText = label || t('authority.use_range')

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [subRes, groupRes] = await Promise.all([
          subscriptionApi.list(),
          groupApi.current_list(GROUP_TYPE.INTERNAL_USER)
        ])
        setSubscriptionList(subRes.list || [])
        setUserGroupList(groupRes || [])

        // 如果有 scopes，加载作用域数据
        if (scopes && scopes.length > 0) {
          const needsDept = scopes.some(s => s.scope_type === 'department' || s.scope_type === 'company')
          const needsUsers = scopes.some(s => s.scope_type === 'user')
          const needsGroups = scopes.some(s => s.scope_type === 'group')

          const [deptTree, userList, groupList] = await Promise.all([
            needsDept ? departmentApi.fetch_department_tree() : Promise.resolve([]),
            needsUsers ? userApi.fetch_internal_user({ status: INTERNAL_USER_STATUS_ALL, offset: 0, limit: 10000 }) : Promise.resolve({ list: [] }),
            needsGroups ? groupApi.current_list(GROUP_TYPE.INTERNAL_USER) : Promise.resolve([]),
          ])

          setScopeDeptTree(deptTree as TreeNode[])
          setScopeUsers(
            (userList.list || []).map((item: any) => ({
              value: item.user_id,
              label: item.nickname || item.name || '',
              user_id: item.user_id,
            }))
          )
          setScopeGroups(
            (groupList || []).map((item: any) => ({
              value: item.group_id,
              label: item.group_name || '',
            }))
          )
        }
      } catch (error) {
        console.error('Failed to fetch auth tag data:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [scopes])

  const hasVisibleSubscriptionItems = useMemo(() => {
    return subscriptionList.some((item) => value.includes(item.group_id))
  }, [subscriptionList, value])

  const hasVisibleUserGroupItems = useMemo(() => {
    return userGroupList.some((item) => value.includes(item.group_id))
  }, [userGroupList, value])

  const hasVisibleItems = hasVisibleSubscriptionItems || hasVisibleUserGroupItems

  // 获取订阅项的 logo
  const getLogoSrc = useCallback((item: SubscriptionItem) => {
    if (!value.includes(item.group_id)) {
      return getPublicPath('/images/subscription/vip-0.png')
    }
    if (item.logo && !/\.png$/.test(item.logo)) {
      return getPublicPath(`/images/subscription/${item.logo}.png`)
    }
    return item.logo || ''
  }, [value])

  // 统一显示列表（用于 compact 模式）
  const displayItems = useMemo<DisplayItem[]>(() => {
    const subscriptionItems = isIndependent
      ? subscriptionList
          .filter(item => value.includes(item.group_id))
          .map(item => ({
            id: item.group_id,
            name: item.group_name,
            type: 'subscription' as const,
            logo: getLogoSrc(item)
          }))
      : []

    const userGroupItems = isEnterprise
      ? userGroupList
          .filter(item => value.includes(item.group_id))
          .map(item => ({
            id: item.group_id,
            name: item.group_name,
            type: 'userGroup' as const
          }))
      : []

    return [...subscriptionItems, ...userGroupItems]
  }, [subscriptionList, userGroupList, value, isIndependent, isEnterprise, getLogoSrc])

  // scopes 辅助函数：在树中递归查找节点
  const findNodeInTree = (nodes: TreeNode[], targetId: number | string): TreeNode | null => {
    for (const node of nodes) {
      if (node.value === targetId || node.did === targetId || node.user_id === targetId) {
        return node
      }
      if (node.children) {
        const found = findNodeInTree(node.children, targetId)
        if (found) return found
      }
    }
    return null
  }

  // 作用域显示项
  const scopeDisplayItems = useMemo(() => {
    if (!scopes || scopes.length === 0) return []

    return scopes.map((scope) => {
      if (scope.scope_type === 'company') {
        return { value: 0, label: '全部成员', type: 'company' as const }
      }
      if (scope.scope_type === 'group') {
        const group = scopeGroups.find((g) => g.value === scope.target_id)
        return { value: scope.target_id, label: group?.label || String(scope.target_id), type: 'group' as const }
      }
      if (scope.scope_type === 'user') {
        const user = scopeUsers.find((u) => u.value === scope.target_id)
        return { value: scope.target_id, label: user?.label || String(scope.target_id), type: 'member' as const }
      }
      // department
      const node = findNodeInTree(scopeDeptTree, scope.target_id)
      return { value: scope.target_id, label: node?.label || String(scope.target_id), type: 'department' as const }
    })
  }, [scopes, scopeDeptTree, scopeUsers, scopeGroups])

  // 图标映射
  const getScopeIconName = (type: 'company' | 'department' | 'member' | 'group') => {
    const iconMap = {
      company: 'department',
      department: 'department',
      member: 'member',
      group: 'user-group',
    }
    return iconMap[type]
  }

  // 宽度容量检测（compact 模式）
  useEffect(() => {
    // 仅在 compact 模式下启用
    if (mode !== 'compact' || displayItems.length === 0) {
      setVisibleCount(null)
      return
    }

    const ul = ulRef.current
    if (!ul) return

    const checkCapacity = () => {
      const lis = ul.querySelectorAll('li[data-item="true"]') as NodeListOf<HTMLElement>
      if (lis.length === 0) return

      // 使用可见容器的宽度
      const containerWidth = visibleUlRef.current?.offsetWidth ?? 0
      if (containerWidth === 0) {
        setVisibleCount(null)
        return
      }

      // 设置隐藏容器的宽度，确保测量准确
      ul.style.width = `${containerWidth}px`

      // 检测换行：找到第一个换行的元素索引
      const firstTop = lis[0].offsetTop
      let firstWrapIndex = -1

      for (let i = 1; i < lis.length; i++) {
        if (lis[i].offsetTop > firstTop + 2) {
          firstWrapIndex = i
          break
        }
      }

      // 没有换行，检查是否需要预留 "+n" 空间
      if (firstWrapIndex === -1) {
        // 测量最后一个标签的右边界
        const lastLi = lis[lis.length - 1]
        const lastRight = lastLi.offsetLeft + lastLi.offsetWidth
        const plusNWidth = 48 // "+n" 标签预估宽度
        const gap = 16

        // 如果加上 "+n" 会超出，需要减少显示数量
        if (lastRight + gap + plusNWidth > containerWidth) {
          // 从后往前找，找到能放下的位置
          for (let i = lis.length - 1; i >= 0; i--) {
            const right = lis[i].offsetLeft + lis[i].offsetWidth
            if (right + gap + plusNWidth <= containerWidth) {
              setVisibleCount(i + 1)
              return
            }
          }
          setVisibleCount(1)
        } else {
          // 所有都能显示，不需要 "+n"
          setVisibleCount(null)
        }
        return
      }

      // 有换行：显示到换行前一个，并预留 "+n" 空间
      // 检查换行前最后一个标签能否放下 "+n"
      const lastBeforeWrap = lis[firstWrapIndex - 1]
      const lastRight = lastBeforeWrap.offsetLeft + lastBeforeWrap.offsetWidth
      const plusNWidth = 48
      const gap = 16

      if (lastRight + gap + plusNWidth <= containerWidth) {
        setVisibleCount(firstWrapIndex)
      } else {
        // 需要再减少一个
        setVisibleCount(Math.max(1, firstWrapIndex - 1))
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(checkCapacity)
    })
    // 监听可见容器的尺寸变化
    if (visibleUlRef.current) {
      resizeObserver.observe(visibleUlRef.current)
    }

    return () => resizeObserver.disconnect()
  }, [mode, displayItems])

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
    <div className="relative">
      {/* 隐藏的测量容器（compact 模式） */}
      {mode === 'compact' && displayItems.length > 0 && (
        <ul
          ref={ulRef}
          className="flex flex-wrap items-center gap-4 absolute left-0 top-0 opacity-0 pointer-events-none"
          style={{ visibility: 'hidden' }}
          aria-hidden="true"
        >
          {!hideLabel && (
            <label
              className={`inline-block text-sm text-regular ${labelPosition === 'top' ? 'w-full -mb-1' : ''}`}
            >
              {labelText}:
            </label>
          )}
          {displayItems.map((item, index) => {
            const isLastSubscription = item.type === 'subscription' &&
              (index === displayItems.length - 1 || displayItems[index + 1]?.type === 'userGroup')
            const hasUserGroupAfter = displayItems.slice(index + 1).some(i => i.type === 'userGroup')

            return (
              <React.Fragment key={item.id}>
                <li
                  data-item="true"
                  className="flex items-center gap-1 text-sm"
                >
                  {item.type === 'subscription' && item.logo && (
                    <img
                      src={item.logo}
                      className="flex-none size-6 rounded-full overflow-auto"
                      alt={item.name}
                    />
                  )}
                  {item.type === 'userGroup' && (
                    <SvgIcon
                      name="peoples-filled"
                      className="flex-none size-6 text-theme"
                    />
                  )}
                  <span className='text-primary'>{item.name}</span>
                </li>
                {isLastSubscription && hasUserGroupAfter && (
                  <li data-item="false" className="inline-flex">
                    <Divider type="vertical" className="!mx-0" />
                  </li>
                )}
              </React.Fragment>
            )
          })}
        </ul>
      )}

      {/* 可见容器 */}
      <ul ref={visibleUlRef} className="flex flex-wrap items-center gap-4 auth-tag-group">
        {!hideLabel && (
          <label
            className={`inline-block text-sm text-regular ${labelPosition === 'top' ? 'w-full -mb-1' : ''}`}
          >
            {labelText}:
          </label>
        )}

        {!hasVisibleItems && scopeDisplayItems.length === 0 && (
          <span className="text-sm text-placeholder">{emptyText}</span>
        )}

        {/* 默认模式：保持原有逻辑 */}
        {mode === 'default' && (
          <>
            {/* Subscription groups for independent/industry */}
            {isIndependent && subscriptionList.map((item) => (
              <li
                key={item.group_id}
                className={`flex items-center gap-1 text-sm ${value.includes(item.group_id) ? 'text-primary' : 'hidden'}`}
              >
                <img
                  src={getLogoSrc(item)}
                  className="flex-none size-6 rounded-full overflow-auto"
                  alt={item.group_name}
                />
                {item.group_name}
              </li>
            ))}

            {/* User groups for enterprise/industry */}
            {isEnterprise && userGroupList.length > 0 && hasVisibleSubscriptionItems && hasVisibleUserGroupItems && (
              <Divider type="vertical" className="!mx-0" />
            )}

            {isEnterprise && userGroupList.map((item) => (
              <li
                key={item.group_id}
                className={`flex items-center gap-1 text-sm ${value.includes(item.group_id) ? 'text-primary' : 'hidden'}`}
              >
                <SvgIcon
                  name="peoples-filled"
                  className={`flex-none size-6 ${value.includes(item.group_id) ? 'text-theme' : 'text-placeholder'}`}
                />
                {item.group_name}
              </li>
            ))}
          </>
        )}

        {/* compact 模式：使用 displayItems */}
        {mode === 'compact' && (
          <>
            {displayItems
              .slice(0, visibleCount ?? undefined)
              .map((item, index, arr) => {
                // 找到 subscription 和 userGroup 的分界点，插入分隔线
                const isLastSubscription = item.type === 'subscription' &&
                  (index === arr.length - 1 || arr[index + 1]?.type === 'userGroup')
                const hasUserGroupAfter = arr.slice(index + 1).some(i => i.type === 'userGroup')

                return (
                  <React.Fragment key={item.id}>
                    <li className="flex items-center gap-1 text-sm text-theme">
                      {item.type === 'subscription' && item.logo && (
                        <img
                          src={item.logo}
                          className="flex-none size-6 rounded-full overflow-auto"
                          alt={item.name}
                        />
                      )}
                      {item.type === 'userGroup' && (
                        <SvgIcon
                          name="peoples-filled"
                          className="flex-none size-6 "
                        />
                      )}
                      <span className="text-primary">{item.name}</span>
                    </li>
                    {/* subscription 和 userGroup 之间插入分隔线 */}
                    {isLastSubscription && hasUserGroupAfter && (
                      <Divider type="vertical" className="!mx-0" />
                    )}
                  </React.Fragment>
                )
              })}

            {/* +n 标签 */}
            {visibleCount !== null && displayItems.length > visibleCount && (
              <Tooltip title={displayItems.slice(visibleCount).map(i => i.name).join('、')}>
                <li className="flex-none flex items-center border rounded px-2 h-6 gap-1 text-sm text-primary cursor-pointer">
                  +{displayItems.length - visibleCount}
                </li>
              </Tooltip>
            )}
          </>
        )}

        {/* scopes 作用域 */}
        {scopeDisplayItems.length > 0 && (
          <>
            {(hasVisibleItems || (value && value.length > 0)) && (
              <Divider type="vertical" className="!mx-0" />
            )}
            {scopeDisplayItems.slice(0, 3).map((item, index) => (
              <li
                key={`scope-${item.value}-${index}`}
                data-item="true"
                className="flex items-center gap-1 text-sm text-theme"
              >
                <SvgIcon
                  name={getScopeIconName(item.type)}
                  className="flex-none size-6 "
                />
                <span className="text-primary">{item.label}</span>
              </li>
            ))}
            {scopeDisplayItems.length > 3 && (
              <Tooltip title={scopeDisplayItems.slice(3).map((i) => i.label).join('、')}>
                <li className="flex-none flex items-center border rounded px-2 h-6 gap-1 text-sm text-primary cursor-pointer">
                  +{scopeDisplayItems.length - 3}
                </li>
              </Tooltip>
            )}
          </>
        )}
      </ul>
    </div>
  )
}

export default AuthTagGroup
