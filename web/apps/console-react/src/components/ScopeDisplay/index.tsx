import { Tooltip } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { useEffect, useRef, useState, useMemo } from 'react'
import { departmentApi } from '@/api/modules/department'
import { groupApi } from '@/api/modules/group'
import { INTERNAL_USER_STATUS_ALL, userApi } from '@/api/modules/user'
import { GROUP_TYPE } from '@/constants/group'
import type { ScopeItem } from '@/api/modules/agent'
import './index.css'

export interface ScopeDisplayTreeNode {
  value: number | string
  label: string
  did?: number
  user_id?: number
  children?: ScopeDisplayTreeNode[]
}

interface ScopeDisplayProps {
  /** scopes 数据 */
  scopes?: ScopeItem[]
  /** 自定义类名 */
  className?: string
  /** 是否显示边框，默认不显示 */
  border?: boolean
  /** 是否紧凑模式，紧凑模式下才显示 +n */
  compact?: boolean
  /** 是否换行，默认不换行 */
  wrap?: boolean
  /** 预加载的部门树（可选，传则不内部加载） */
  treeData?: ScopeDisplayTreeNode[]
  /** 预加载的用户列表（可选，传则不内部加载） */
  users?: ScopeDisplayTreeNode[]
  /** 预加载的分组列表（可选，传则不内部加载） */
  groups?: ScopeDisplayTreeNode[]
}

export default function ScopeDisplay({
  scopes,
  className,
  border = false,
  compact = false,
  wrap = false,
  treeData: externalTreeData,
  users: externalUsers,
  groups: externalGroups,
}: ScopeDisplayProps) {
  const [treeData, setTreeData] = useState<ScopeDisplayTreeNode[]>([])
  const [users, setUsers] = useState<ScopeDisplayTreeNode[]>([])
  const [groups, setGroups] = useState<ScopeDisplayTreeNode[]>([])

  const dataLoadedRef = useRef(false)

  // 辅助函数：在树中递归查找节点
  const findNodeInTree = (nodes: ScopeDisplayTreeNode[], targetId: number | string): ScopeDisplayTreeNode | null => {
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

  // 根据 ScopeItem 获取显示项
  const getDisplayItem = (scope: ScopeItem) => {
    if (scope.scope_type === 'company') {
      return {
        value: 0,
        label: '全部成员',
        type: 'company' as const,
      }
    }

    if (scope.scope_type === 'group') {
      const group = (externalGroups || groups).find((g) => g.value === scope.target_id)
      return {
        value: scope.target_id,
        label: group?.label || String(scope.target_id),
        type: 'group' as const,
      }
    }

    if (scope.scope_type === 'user') {
      const user = (externalUsers || users).find((u) => u.value === scope.target_id)
      return {
        value: scope.target_id,
        label: user?.label || String(scope.target_id),
        type: 'member' as const,
      }
    }

    // department
    const node = findNodeInTree(externalTreeData || treeData, scope.target_id)
    return {
      value: scope.target_id,
      label: node?.label || String(scope.target_id),
      type: 'department' as const,
    }
  }

  // 计算显示项
  const displayItems = useMemo(() => {
    if (!scopes || scopes.length === 0) return []
    return scopes.map(getDisplayItem)
  }, [scopes, externalTreeData, treeData, externalUsers, users, externalGroups, groups])

  const [visibleCount, setVisibleCount] = useState<number | null>(null)
  const ulRef = useRef<HTMLUListElement>(null)

  // 检测是否换行，动态调整显示数量
  useEffect(() => {
    const ul = ulRef.current
    if (!ul || displayItems.length <= 3) {
      setVisibleCount(null)
      return
    }

    const checkOverflow = () => {
      if (!ul) return

      const lis = ul.querySelectorAll('li[data-item="true"]')
      if (lis.length < 2) {
        setVisibleCount(3)
        return
      }

      const firstTop = lis[0].offsetTop
      for (let i = 1; i < lis.length; i++) {
        if (lis[i].offsetTop > firstTop + 2) {
          // 换行了，保留到换行前一个，再减 2 给 +n 留空间
          setVisibleCount(Math.max(1, i - 1))
          return
        }
      }
      // 没换行，最多显示 3 个
      setVisibleCount(3)
    }

    // 监听容器尺寸变化
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(checkOverflow)
    })
    resizeObserver.observe(ul)

    return () => {
      resizeObserver.disconnect()
    }
  }, [displayItems])

  // 图标映射
  const getIconName = (type: 'company' | 'department' | 'member' | 'group') => {
    const iconMap = {
      company: 'department',
      department: 'department',
      member: 'member',
      group: 'user-group',
    }
    return iconMap[type]
  }

  // 加载数据（如果未提供外部数据）
  useEffect(() => {
    // 如果外部传入了数据，则不内部加载
    if (externalTreeData && externalUsers && externalGroups) return
    if (dataLoadedRef.current) return
    dataLoadedRef.current = true

    const loadData = async () => {
      const [deptTree, userList, groupList] = await Promise.all([
        departmentApi.fetch_department_tree(),
        userApi.fetch_internal_user({
          status: INTERNAL_USER_STATUS_ALL,
          offset: 0,
          limit: 10000,
        }),
        groupApi.list({
          params: { group_type: GROUP_TYPE.INTERNAL_USER },
        }),
      ])

      if (!externalTreeData) setTreeData(deptTree)
      if (!externalUsers) {
        setUsers(
          userList.list.map((item: any) => ({
            value: item.user_id,
            label: item.nickname || item.name || '',
            user_id: item.user_id,
          }))
        )
      }
      if (!externalGroups) {
        setGroups(
          groupList.map((item: any) => ({
            value: item.group_id,
            label: item.group_name || '',
          }))
        )
      }
    }

    loadData()
  }, [])

  // 空数据显示 "--"
  if (!scopes || scopes.length === 0) {
    return <span className={`text-placeholder ${className || ''}`}>--</span>
  }

  // 渲染作用域标签
  return (
    <div className={className}>
      <ul
        ref={ulRef}
        className={`w-full flex items-center ${wrap ? 'flex-wrap' : 'flex-nowrap'} gap-2`}
      >
        {displayItems.slice(0, compact ? visibleCount ?? 3 : displayItems.length).map((item, index) => (
          <li
            key={item.value ?? index}
            data-item="true"
            className={`h-8 flex items-center gap-1 box-border ${border ? 'border border-[#E5E5E5]  px-2' : ''} rounded text-tertiary`}
          >
            <SvgIcon
              name={getIconName(item.type)}
              width="16px"
              height="16px"
              color="#57A1FF"
            />
            <span>{item.label}</span>
          </li>
        ))}
        {compact && displayItems.length > (visibleCount ?? 3) && (
          <Tooltip
            title={displayItems
              .slice(visibleCount ?? 3)
              .map((i) => i.label)
              .join('、')}
          >
            <li className={`h-8 flex items-center rounded text-tertiary cursor-pointer ${border ? 'border  px-2 border-[#E5E5E5]' : ''}`}>
              +{displayItems.length - (visibleCount ?? 3)}
            </li>
          </Tooltip>
        )}
      </ul>
    </div>
  )
}