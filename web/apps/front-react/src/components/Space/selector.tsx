import { useState, useMemo, useRef, useEffect, forwardRef, useImperativeHandle, ReactNode, useCallback } from 'react'
import { Popover, Spin } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import { Search, SvgIcon } from '@km/shared-components-react'
import { useSpaceStore } from '@/stores/modules/space'
import librariesApi, { type LibraryItem } from '@/api/modules/libraries'
import permissionsApi from '@/api/modules/permissions'
import { RESOURCE_TYPE, PERMISSION_TYPE } from '@/components/KMPermission/constant'
import { getPublicPath } from '@/utils/config'
import './selector.css'

const SUB_ITEM_TYPE = {
  ALL: 'all',
  SPACE: 'space',
  LIBRARY: 'library',
} as const

interface SubItem {
  id: string
  name: string
  type: (typeof SUB_ITEM_TYPE)[keyof typeof SUB_ITEM_TYPE]
}

interface SpaceItem {
  id: string
  name: string
  icon: string
  permission?: number
}

interface SpaceSelectorProps {
  disabled?: boolean
  children?: ReactNode
  onChange?: (item: { name: string; value: string[]; isSpace?: boolean }) => void
}

export interface SpaceSelectorRef {
  setSelectedSubItem: (item: SubItem) => void
}

export const SpaceSelector = forwardRef<SpaceSelectorRef, SpaceSelectorProps>(
  ({ disabled = false, children, onChange }, ref) => {
    const spaceStore = useSpaceStore()

    const allSubItem: SubItem = { id: 'all', name: '全部知识库', type: SUB_ITEM_TYPE.ALL }

    const [visible, setVisible] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedSubItem, setSelectedSubItem] = useState<SubItem>({ ...allSubItem })
    const [spaceList, setSpaceList] = useState<SpaceItem[]>([])
    const [libraryDict, setLibraryDict] = useState<Record<string, { list: LibraryItem[]; loading: boolean }>>({})
    const [filteredKnowledgeBases, setFilteredKnowledgeBases] = useState<LibraryItem[]>([])

    const isInit = useRef(false)
    // 使用 ref 保持 libraryDict 的最新引用
    const libraryDictRef = useRef(libraryDict)
    libraryDictRef.current = libraryDict

    const filteredTeamSpaces = useMemo(() => {
      if (!searchQuery) return spaceList
      return spaceList.filter((space) =>
        space.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }, [searchQuery, spaceList])

    const selectSubItem = useCallback((data: SubItem) => {
      setSelectedSubItem({ ...data })

      if (data.type === SUB_ITEM_TYPE.ALL) {
        onChange?.({ name: data.name, value: [data.id] })
      } else if (data.type === SUB_ITEM_TYPE.SPACE) {
        const libraryData = libraryDictRef.current[data.id]
        if (libraryData) {
          onChange?.({
            name: data.name,
            value: libraryData.list.map((item) => item.id),
            isSpace: true,
          })
        }
      } else if (data.type === SUB_ITEM_TYPE.LIBRARY) {
        onChange?.({ name: data.name, value: [data.id] })
      }
    }, [onChange])

    const highlightText = useCallback((text: string, query: string) => {
      if (!query) return text
      // 转义正则特殊字符，避免报错
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`(${escapedQuery})`, 'gi')
      return text.replace(regex, '<span class="text-blue-600 font-medium">$1</span>')
    }, [])

    const loadLibraryList = useCallback(async (spaceId: string) => {
      // 如果已经加载过或正在加载，直接返回
      const current = libraryDictRef.current[spaceId]
      if (current && (current.list.length > 0 || current.loading === false)) return

      // 先设置 loading 状态
      setLibraryDict((prev) => ({ ...prev, [spaceId]: { list: [], loading: true } }))

      try {
        const list = await librariesApi.list({
          space_id: spaceId,
          get_recently: 0,
          limit: 100,
        })
        if (list.length === 0) {
          setLibraryDict((prev) => ({
            ...prev,
            [spaceId]: { list: [], loading: false },
          }))
          return
        }
        const permissionMap = await permissionsApi.myBatch({
          resource_type: RESOURCE_TYPE.library,
          resource_ids: list.map((item) => item.id),
        })
        const itemsWithPermission = list
          .filter((item) => {
            const key = `${RESOURCE_TYPE.library}:${item.id}`
            return permissionMap[key] >= PERMISSION_TYPE.viewer
          })
          .map((item) => {
            const key = `${RESOURCE_TYPE.library}:${item.id}`
            return { ...item, permission: permissionMap[key] }
          })
        setLibraryDict((prev) => ({
          ...prev,
          [spaceId]: {
            list: itemsWithPermission,
            loading: false,
          },
        }))
      } catch (error) {
        console.error('Failed to load library list:', error)
        setLibraryDict((prev) => ({
          ...prev,
          [spaceId]: { list: [], loading: false },
        }))
      }
    }, [])

    const onShow = useCallback(() => {
      setVisible(true)
      if (isInit.current) return
      spaceStore.loadSpaceList().then(async (list) => {
        if (list.length === 0) {
          setSpaceList([])
          isInit.current = true
          return
        }
        const permissionMap = await permissionsApi.myBatch({
          resource_type: RESOURCE_TYPE.space,
          resource_ids: list.map((item) => item.id),
        })
        const spaces = list
          .filter((item) => {
            const key = `${RESOURCE_TYPE.space}:${item.id}`
            return permissionMap[key] >= PERMISSION_TYPE.viewer
          })
          .map((item) => {
            const key = `${RESOURCE_TYPE.space}:${item.id}`
            return { ...item, permission: permissionMap[key] }
          })
        setSpaceList(spaces)
        isInit.current = true
      })
    }, [spaceStore])

    useEffect(() => {
      if (!searchQuery) {
        setFilteredKnowledgeBases([])
      } else {
        // 使用 search API，参考 Vue 版本
        librariesApi.search({ name: searchQuery }).then((res) => {
          setFilteredKnowledgeBases(res || [])
        })
      }
    }, [searchQuery])

    useImperativeHandle(ref, () => ({
      setSelectedSubItem: (item: SubItem) => {
        setSelectedSubItem(item)
      },
    }))

    // 渲染团队空间子菜单
    const renderSpaceSubmenu = useCallback((space: SpaceItem) => {
      const libraryData = libraryDictRef.current[space.id]

      return (
        <div className="space-selector-submenu">
          {/* 子菜单标题 - 选择整个空间 */}
          <div
            className={`space-selector-submenu-item ${
              selectedSubItem.id === space.id ? 'selected' : ''
            }`}
            onClick={() =>
              selectSubItem({
                id: space.id,
                name: space.name,
                type: SUB_ITEM_TYPE.SPACE,
              })
            }
          >
            <div className="size-6 flex items-center justify-center">
              {space.icon.includes('icon.png') ? (
                <SvgIcon name="app-one" size={16} />
              ) : (
                <img src={space.icon} className="size-6" alt="" />
              )}
            </div>
            <span className="flex-1 text-sm font-medium truncate">{space.name}的全部知识库</span>
            {selectedSubItem.id === space.id && (
              <CheckOutlined className="check-icon" />
            )}
          </div>

          {/* 子菜单项 - 具体知识库 */}
          <Spin spinning={libraryData?.loading ?? false} size="small">
            <div className="space-selector-submenu-list">
              {libraryData?.list?.map((item) => (
                <div
                  key={item.id}
                  className={`space-selector-submenu-item ${
                    selectedSubItem.id === item.id ? 'selected' : ''
                  }`}
                  onClick={() =>
                    selectSubItem({
                      id: item.id,
                      name: item.name,
                      type: SUB_ITEM_TYPE.LIBRARY,
                    })
                  }
                >
                  <div className="size-6 flex items-center justify-center">
                    <img src={item.icon} className="size-6" alt="" />
                  </div>
                  <span className="text-sm flex-1 truncate">{item.name}</span>
                  {selectedSubItem.id === item.id && (
                    <CheckOutlined className="check-icon" />
                  )}
                </div>
              ))}
              {!libraryData?.loading && (!libraryData?.list || libraryData.list.length === 0) && (
                <div className="text-center text-xs text-gray-400 py-2">暂无知识库</div>
              )}
            </div>
          </Spin>
        </div>
      )
    }, [selectedSubItem, selectSubItem])

    const content = (
      <div className="space-selector-content">
        {/* 搜索栏 */}
        <div className="space-selector-search">
          <Search
            mode="expanded"
            value={searchQuery}
            onDebouncedChange={setSearchQuery}
            placeholder="搜索团队空间或知识库"
            className="space-selector-search-input"
            style={{ backgroundColor: '#EDEFF2' }}
          />
        </div>

        {/* 内容区域 */}
        {visible && (
          <div className="space-selector-list">
            {/* 全部知识库 */}
            {!searchQuery && (
              <div
                className={`space-selector-item ${
                  selectedSubItem.id === allSubItem.id ? 'selected' : ''
                }`}
                onClick={() => selectSubItem(allSubItem)}
              >
                <div className="space-selector-item-icon">
                  <SvgIcon name="documents" size={16} />
                </div>
                <span className="space-selector-item-text">{allSubItem.name}</span>
              </div>
            )}

            {/* 团队空间标题 */}
            <h3 className="space-selector-section-title">团队空间</h3>

            {/* 团队空间列表 */}
            {filteredTeamSpaces.map((space) => (
              <Popover
                key={space.id}
                placement="rightTop"
                trigger="hover"
                content={renderSpaceSubmenu(space)}
                mouseEnterDelay={0.1}
                mouseLeaveDelay={0.1}
                onOpenChange={(open) => {
                  if (open) loadLibraryList(space.id)
                }}
              >
                <div className="space-selector-item">
                  <div className="space-selector-item-icon">
                    <SvgIcon name="app-one" size={16} />
                  </div>
                  <span className="space-selector-item-text flex-1">{space.name}</span>
                  <div className="ml-auto">
                    <SvgIcon name="arrow-right" className="w-4 h-4 text-gray-400" />
                  </div>
                </div>
              </Popover>
            ))}

            {/* 搜索结果 - 知识库 */}
            {searchQuery && filteredKnowledgeBases.length > 0 && (
              <div className="space-selector-knowledge">
                <h3 className="text-sm font-medium text-gray-700 mb-3">知识库</h3>
                {filteredKnowledgeBases.map((kb) => (
                  <div
                    key={kb.id}
                    className={`space-selector-item ${
                      selectedSubItem.id === kb.id ? 'selected' : ''
                    }`}
                    onClick={() =>
                      selectSubItem({
                        id: kb.id,
                        name: kb.name,
                        type: SUB_ITEM_TYPE.LIBRARY,
                      })
                    }
                  >
                    <div className="space-selector-item-icon">
                      <img src={kb.icon} className="size-6" alt="" />
                    </div>
                    <span
                      className="space-selector-item-text"
                      dangerouslySetInnerHTML={{ __html: highlightText(kb.name, searchQuery) }}
                    />
                    {selectedSubItem.id === kb.id && <CheckOutlined className="check-icon" />}
                  </div>
                ))}
              </div>
            )}

            {/* 空状态 */}
            {searchQuery && filteredTeamSpaces.length === 0 && filteredKnowledgeBases.length === 0 && (
              <div className="space-selector-empty">
                <img src={getPublicPath('/images/empty.png')} className="size-16" alt="" />
                <p className="text-sm text-gray-500">未找到相关结果</p>
              </div>
            )}
          </div>
        )}
      </div>
    )

    return (
      <Popover
        content={content}
        trigger="click"
        placement="bottomLeft"
        open={visible}
        onOpenChange={(open) => {
          if (open) onShow()
          else setVisible(false)
        }}
        disabled={disabled}
      >
        {children}
      </Popover>
    )
  }
)

SpaceSelector.displayName = 'SpaceSelector'

export default SpaceSelector
