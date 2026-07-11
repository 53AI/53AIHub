import { useState, useMemo, useEffect, useRef } from 'react'
import { Tree, Spin, Empty } from 'antd'
import type { TreeDataNode, TreeProps } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { useSkillEditStore } from '@/stores/modules/skillEdit'
import type { SkillFileItem } from '@/api/modules/skill/types'
import '../index.scss'

/** 自定义展开/收起箭头图标 */
const SwitcherIcon: TreeProps['switcherIcon'] = ({ expanded }) => {
  return (
    <SvgIcon
      name="down"
      size={16}
      className={`text-gray-400 ${expanded ? '' : '-rotate-90'}`}
    />
  )
}

/** 转换文件列表为树形数据 */
function transformToTreeData(files: SkillFileItem[]): TreeDataNode[] {
  return files.map(file => {
    const isFolder = file.type === 'directory'

    return {
      key: file.path,
      title: (
        <span className="flex items-center gap-1.5">
          {isFolder ? (
            <SvgIcon name="dir" size={16} />
          ) : (
            <SvgIcon name="file_v2" size={16} />
          )}
          <span>{file.name}</span>
        </span>
      ),
      icon: null,
      isLeaf: !isFolder,
      children: file.children ? transformToTreeData(file.children) : undefined,
    }
  })
}

/** 在树中查找指定路径的节点 */
function findNodeInTree(files: SkillFileItem[], path: string): SkillFileItem | null {
  for (const file of files) {
    if (file.path === path) return file
    if (file.children) {
      const found = findNodeInTree(file.children, path)
      if (found) return found
    }
  }
  return null
}

export function SkillFileTree() {
  const {
    files,
    filesLoading,
    currentFile,
    selectFile,
  } = useSkillEditStore()

  // 受控展开状态
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])
  const initializedRef = useRef(false)

  // 文件加载后初始化展开状态（展开第一层文件夹）
  useEffect(() => {
    if (files.length > 0 && !initializedRef.current) {
      initializedRef.current = true
      const firstLevelFolders = files.filter(f => f.type === 'directory').map(f => f.path)
      setExpandedKeys(firstLevelFolders)
    }
  }, [files])

  // 转换为 Ant Design Tree 数据格式
  const treeData = useMemo(() => transformToTreeData(files), [files])

  // 当前选中的节点
  const selectedKeys = currentFile ? [currentFile.path] : []

  // 切换文件夹展开/收起
  const handleExpand: TreeProps['onExpand'] = (keys) => {
    setExpandedKeys(keys as string[])
  }

  // 点击节点：文件夹切换展开，文件选中
  const handleSelect: TreeProps['onSelect'] = (keys, info) => {
    if (keys.length === 0) return

    const path = keys[0] as string
    const node = findNodeInTree(files, path)
    if (!node) return

    if (node.type === 'directory') {
      // 文件夹：切换展开/收起
      setExpandedKeys(prev =>
        prev.includes(path) ? prev.filter(k => k !== path) : [...prev, path]
      )
    } else {
      // 文件：选中
      selectFile(node)
    }
  }

  if (filesLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spin />
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Empty description="暂无文件" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto skill-file-tree">
      <Tree
        treeData={treeData}
        switcherIcon={SwitcherIcon}
        selectedKeys={selectedKeys}
        expandedKeys={expandedKeys}
        onExpand={handleExpand}
        onSelect={handleSelect}
        blockNode
      />
    </div>
  )
}

export default SkillFileTree