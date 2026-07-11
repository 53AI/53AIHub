import { useState } from 'react'
import { Modal } from 'antd'
import { DeptMemberPicker } from '../DeptMemberPicker'
import { RolePopover } from './RolePopover'
import { PERMISSION_TYPE, SUBJECT_TYPE, type PermissionType, type SubjectType } from './constant'
import './MemberSelector.css'

interface PickerItem {
  label: string
  value: string | number
  type: 'member' | 'group' | 'company'
  permission: PermissionType
  avatar: string
}

interface MemberResult {
  subject_id: number
  subject_type: SubjectType
  permission: PermissionType
}

interface MemberSelectorProps {
  trigger?: React.ReactNode
  onConfirm?: (result: { list: MemberResult[] }) => void
}

export function MemberSelector({ trigger, onConfirm }: MemberSelectorProps) {
  const [memberList, setMemberList] = useState<PickerItem[]>([])
  const [visible, setVisible] = useState(false)

  const handleUserAddConfirm = (selectedItems: any[]) => {
    const items = selectedItems.map((item) => {
      const isCompany = item.value === 0
      return {
        label: isCompany ? '全体成员' : item.label,
        type: isCompany ? 'company' : item.type,
        value: item.value,
        avatar: isCompany
          ? '/images/space/peoples.png'
          : '/images/space/people.png',
        permission: PERMISSION_TYPE.viewer,
      }
    })
    setMemberList(items)
    setVisible(true)
  }

  const handleCancel = () => {
    setMemberList([])
    setVisible(false)
  }

  const handleConfirm = () => {
    const userList = memberList.filter((item) => item.type === 'member')
    const groupList = memberList.filter((item) => item.type === 'group')
    const companyList = memberList.filter((item) => item.type === 'company')

    onConfirm?.({
      list: [
        ...userList.map((item) => ({
          subject_id: Number(item.value),
          subject_type: SUBJECT_TYPE.user,
          permission: item.permission,
        })),
        ...groupList.map((item) => ({
          subject_id: Number(item.value),
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
  }

  const handlePermissionChange = (index: number, permission: PermissionType) => {
    setMemberList((prev) => {
      const newList = [...prev]
      newList[index] = { ...newList[index], permission }
      return newList
    })
  }

  return (
    <div className="member-selector">
      <DeptMemberPicker
        value={[]}
        onChange={handleUserAddConfirm}
        defaultFirstValue={false}
        type="user"
        showGroup
        allowSelectAllCompany
        trigger={trigger}
      />

      <Modal
        open={visible}
        title="添加用户"
        onCancel={handleCancel}
        onOk={handleConfirm}
        okText="确定"
        cancelText="取消"
        width={400}
        centered
      >
        <div className="member-list">
          {memberList.map((item, index) => (
            <div key={item.value} className="member-item">
              <img src={item.avatar} alt="avatar" className="member-avatar" />
              <p className="member-name">{item.label}</p>
              <RolePopover
                value={item.permission}
                none
                onChange={(permission) => handlePermissionChange(index, permission)}
              />
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}

export default MemberSelector
