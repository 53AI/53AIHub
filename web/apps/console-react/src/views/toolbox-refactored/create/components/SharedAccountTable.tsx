import { memo, useCallback, useMemo } from 'react'

import { Button, Table } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import type { ColumnsType } from 'antd/es/table'

import type { SharedAccountItem } from './SharedAccountDialog'
import { t } from '@/locales'

// ============================================================================
// Types
// ============================================================================

export interface SharedAccountTableProps {
  /** 数据源 */
  data: SharedAccountItem[]
  /** 编辑回调 */
  onEdit: (item: SharedAccountItem) => void
  /** 删除回调 */
  onDelete: (item: SharedAccountItem) => void
  /** 行点击回调 */
  onRowClick: (item: SharedAccountItem) => void
}

// ============================================================================
// Component
// ============================================================================

function SharedAccountTableInternal({
  data,
  onEdit,
  onDelete,
  onRowClick,
}: SharedAccountTableProps) {
  // 处理编辑
  const handleEdit = useCallback(
    (e: React.MouseEvent, record: SharedAccountItem) => {
      e.stopPropagation()
      onEdit(record)
    },
    [onEdit],
  )

  // 处理删除
  const handleDelete = useCallback(
    (e: React.MouseEvent, record: SharedAccountItem) => {
      e.stopPropagation()
      onDelete(record)
    },
    [onDelete],
  )

  // 列定义
  const columns: ColumnsType<SharedAccountItem> = useMemo(
    () => [
      {
        title: t('account'),
        dataIndex: 'account',
        key: 'account',
        minWidth: 140,
        ellipsis: true,
        render: (value) => value || '--',
      },
      {
        title: t('password'),
        dataIndex: 'password',
        key: 'password',
        minWidth: 140,
        ellipsis: true,
        render: (value) => value || '--',
      },
      {
        title: t('remark'),
        dataIndex: 'remark',
        key: 'remark',
        minWidth: 140,
        ellipsis: true,
        render: (value) => value || '--',
      },
      {
        title: t('operation'),
        key: 'operation',
        width: 120,
        align: 'left',
        render: (_, record) => (
          <div className="flex gap-2">
            <Button
              type="link"
              icon={<SvgIcon name="edit" />}
              className="text-secondary hover:!text-brand"
              onClick={(e) => handleEdit(e, record)}
            />
            <Button
              type="link"
              icon={<SvgIcon name="delete" />}
              className="text-secondary hover:!text-tag-red"
              onClick={(e) => handleDelete(e, record)}
            />
          </div>
        ),
      },
    ],
    [handleEdit, handleDelete],
  )

  // 行属性
  const onRow = useCallback(
    (record: SharedAccountItem) => ({
      onClick: () => onRowClick(record),
      className: 'group cursor-pointer',
    }),
    [onRowClick],
  )

  return (
    <Table
      rowKey="account"
      columns={columns}
      dataSource={data}
      pagination={false}
      size="small"
      className="[&_.ant-table-thead>tr>th]:!bg-[#F6F7F8] [&_.ant-table-thead>tr>th]:!h-[60px] [&_.ant-table-thead>tr>th]:!border-none"
      onRow={onRow}
    />
  )
}

SharedAccountTableInternal.displayName = 'SharedAccountTable'

export const SharedAccountTable = memo(SharedAccountTableInternal)

export default SharedAccountTable
