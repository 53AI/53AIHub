import { useState, useCallback, useMemo } from 'react'
import { Button, Modal, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import DeptMemberPicker from '@/components/DeptMemberPicker'
import PermissionSelector from './selector'
import { PERMISSION_TYPE, RESOURCE_TYPE, SUBJECT_TYPE, type PermissionType, type SubjectType } from './constant'
import { t } from '@/locales'
import { getRealPath } from '@/utils/config'

interface PickerItem {
  label: string
  value: string | number
  type: 'member' | 'group' | 'company'
  /** 知识库权限，未选择时为 undefined */
  permission?: PermissionType
  /** Wiki 权限，未选择时为 undefined */
  wikiPermission?: PermissionType
  avatar: string
}

export interface MemberSelectorProps {
  onConfirm?: (value: {
    list: {
      subject_id: number
      subject_type: SubjectType
      /** 知识库权限，未选择时为 undefined，不创建该维度权限 */
      permission?: PermissionType
      /** 仅在 showWiki 时返回；未选择时为 undefined，不创建该维度权限 */
      wiki_permission?: PermissionType
    }[]
  }) => void
  /** 是否同时选择 Wiki 权限（双权限模式） */
  showWiki?: boolean
  children?: React.ReactNode
}

export function MemberSelector({ onConfirm, showWiki = false, children }: MemberSelectorProps) {
  const [memberList, setMemberList] = useState<PickerItem[]>([])
  const [visible, setVisible] = useState(false)

  const handleUserAddConfirm = useCallback((result: { value: any[] }) => {
    const items = (result.value || []).map((item: any) => {
      const isCompany = item.value === 0
      // 推断 type：如果 item.type 不存在，则根据数据推断
      let itemType = item.type
      if (!itemType) {
        if (isCompany) {
          itemType = 'company'
        } else if (item.group_id !== undefined || (item.user_id === undefined && item.group_name !== undefined)) {
          itemType = 'group'
        } else {
          itemType = 'member'
        }
      }
      return {
        label: isCompany ? t('space.all_members') : item.label,
        type: itemType,
        value: item.value,
        avatar: isCompany
          ? getRealPath('/images/space/peoples.png')
          : getRealPath('/images/space/people.png'),
        permission: PERMISSION_TYPE.viewer,
      }
    })
    setMemberList(items)
    setVisible(true)
  }, [])

  const handleCancel = useCallback(() => {
    setMemberList([])
    setVisible(false)
  }, [])

  const handleConfirm = useCallback(() => {
    const userList = memberList.filter((item) => item.type === 'member')
    const groupList = memberList.filter((item) => item.type === 'group')
    const companyList = memberList.filter((item) => item.type === 'company')

    onConfirm?.({
      list: [
        ...userList.map((item) => ({
          subject_id: item.value as number,
          subject_type: SUBJECT_TYPE.user,
          permission: item.permission,
          wiki_permission: showWiki ? item.wikiPermission : undefined,
        })),
        ...groupList.map((item) => ({
          subject_id: item.value as number,
          subject_type: SUBJECT_TYPE.group,
          permission: item.permission,
          wiki_permission: showWiki ? item.wikiPermission : undefined,
        })),
        ...companyList.map((item) => ({
          subject_id: 0,
          subject_type: SUBJECT_TYPE.company_all,
          permission: item.permission,
          wiki_permission: showWiki ? item.wikiPermission : undefined,
        })),
      ],
    })
    handleCancel()
  }, [memberList, onConfirm, handleCancel, showWiki])

  /** 按稳定键（type + value）匹配行，避免依赖对象引用（引用会随其他维度权限更新而变化） */
  const updateMemberItem = useCallback(
    (record: PickerItem, patch: Partial<Pick<PickerItem, 'permission' | 'wikiPermission'>>) => {
      setMemberList((prev) =>
        prev.map((item) =>
          item.type === record.type && item.value === record.value ? { ...item, ...patch } : item,
        ),
      )
    },
    [],
  )

  const handlePermissionChange = useCallback(
    (record: PickerItem, permission: PermissionType) => {
      updateMemberItem(record, { permission })
    },
    [updateMemberItem],
  )

  const handleWikiPermissionChange = useCallback(
    (record: PickerItem, permission: PermissionType) => {
      updateMemberItem(record, { wikiPermission: permission })
    },
    [updateMemberItem],
  )

  const handlePermissionUnselected = useCallback(
    (record: PickerItem) => {
      updateMemberItem(record, { permission: undefined })
    },
    [updateMemberItem],
  )

  const handleWikiPermissionUnselected = useCallback(
    (record: PickerItem) => {
      updateMemberItem(record, { wikiPermission: undefined })
    },
    [updateMemberItem],
  )

  const columns: ColumnsType<PickerItem> = useMemo(() => {
    const userColumn = {
      title: t('space.members.col_user'),
      key: 'user',
      render: (_: unknown, record: PickerItem) => (
        <div className="flex items-center gap-2">
          <img src={record.avatar} alt="avatar" className="w-5 h-5 rounded-full" />
          <span className="flex-1 min-w-0 text-sm text-primary truncate">{record.label}</span>
        </div>
      ),
    }

    if (!showWiki) {
      return [
        userColumn,
        {
          title: t('space.members.col_permission'),
          key: 'permission',
          align: 'center',
          render: (_: unknown, record: PickerItem) => (
            <PermissionSelector
              value={record.permission}
              onChange={(permission) => handlePermissionChange(record, permission)}
              buttonType="link"
              none={true}
              teleported={false}
            />
          ),
        },
      ]
    }

    return [
      userColumn,
      {
        title: t('space.members.col_knowledge_permission'),
        key: 'permission',
        align: 'center',
        render: (_: unknown, record: PickerItem) => (
          <PermissionSelector
            value={record.permission}
            placeholder={t('space.members.unselected')}
            onChange={(permission) => handlePermissionChange(record, permission)}
            buttonType="link"
            none={true}
          />
        ),
      },
      {
        title: t('space.members.col_wiki_permission'),
        key: 'wikiPermission',
        align: 'center',
        render: (_: unknown, record: PickerItem) => (
          <PermissionSelector
            value={record.wikiPermission}
            placeholder={t('space.members.unselected')}
            unselected
            onUnselected={() => handleWikiPermissionUnselected(record)}
            onChange={(permission) => handleWikiPermissionChange(record, permission)}
            resourceType={RESOURCE_TYPE.wiki}
            buttonType="link"
            none={true}
          />
        ),
      },
    ]
  }, [showWiki, handlePermissionChange, handleWikiPermissionChange, handlePermissionUnselected, handleWikiPermissionUnselected])

  return (
    <div>
      <DeptMemberPicker
        value={memberList.map((m) => ({ value: m.value, label: m.label }))}
        onConfirm={handleUserAddConfirm}
        type="user"
        showGroup
        allowSelectAllCompany
        defaultFirstValue={false}
        trigger={children}
      />

      <Modal
        title={t('action.add')}
        open={visible}
        onCancel={handleCancel}
        footer={
          <>
            <Button onClick={handleCancel}>{t('action.cancel')}</Button>
            <Button type="primary" onClick={handleConfirm}>{t('action.confirm')}</Button>
          </>
        }
        width={showWiki ? 560 : 440}
      >
        <Table
          rowKey={(record) => `${record.type}-${record.value}`}
          columns={columns}
          dataSource={memberList}
          pagination={false}
          components={{
            header: {
              cell: (props: any) => (
                <th {...props} className="!bg-[#F5F6F7] !text-[#999999]" />
              ),
            },
          }}
        />
      </Modal>
    </div>
  )
}

export default MemberSelector
