import { Modal, Button } from 'antd'
import { useState, useCallback } from 'react'
import DeptMemberPicker from '@/components/DeptMemberPicker'
import PermissionSelector from './selector'
import { PERMISSION_TYPE, SUBJECT_TYPE, type PermissionType, type SubjectType } from './constant'
import { t } from '@/locales'
import { getRealPath } from '@/utils/config'

interface PickerItem {
  label: string
  value: string | number
  type: 'member' | 'group' | 'company'
  permission: PermissionType
  avatar: string
}

export interface MemberSelectorProps {
  onConfirm?: (value: {
    list: { subject_id: number; subject_type: SubjectType; permission: PermissionType }[]
  }) => void
  children?: React.ReactNode
}

export function MemberSelector({ onConfirm, children }: MemberSelectorProps) {
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
        })),
        ...groupList.map((item) => ({
          subject_id: item.value as number,
          subject_type: SUBJECT_TYPE.group,
          permission: item.permission,
        })),
        ...companyList.map((item) => ({
          subject_id: 0,
          subject_type: SUBJECT_TYPE.company_all,
          permission: item.permission,
        })),
      ],
    })
    handleCancel()
  }, [memberList, onConfirm, handleCancel])

  const handlePermissionChange = useCallback((index: number, permission: PermissionType) => {
    setMemberList((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], permission }
      return next
    })
  }, [])

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
        width={400}
      >
        <div className="p-3 bg-[#F7F8FA] rounded-md space-y-1.5">
          {memberList.map((item, index) => (
            <div key={item.value} className="h-8 flex items-center justify-between gap-2">
              <img src={item.avatar} alt="avatar" className="w-5 h-5 rounded-full" />
              <p className="flex-1 text-sm text-primary truncate">{item.label}</p>
              <PermissionSelector
                value={item.permission}
                onChange={(permission) => handlePermissionChange(index, permission)}
                buttonType="link"
                none={true}
                teleported={false}
              />
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}

export default MemberSelector
