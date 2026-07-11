import { useState, useEffect, useCallback } from 'react'
import { Button, message } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { MemberSelector } from '@/components/KMPermission/MemberSelector'
import { t } from '@/locales'
import { RolePopover } from '@/components/KMPermission/RolePopover'
import { GroupList } from '@/components/KMPermission/group-list'
import { EntityDisplay } from '@/components/EntityDisplay'
import { permissionsApi, type PermissionItem } from '@/api/modules/permissions'
import { RESOURCE_TYPE, PERMISSION_TYPE, SUBJECT_TYPE } from '@/components/KMPermission/constant'
import { useLibraryStore } from '@/stores/modules/library'
import { useUserStore } from '@/stores/modules/user'
import { getPublicPath } from '@/utils/config'
import './permission-setting.css'

interface PermissionSettingProps {
  onClose?: () => void
  className?: string
}

// Default permissions structure - matches Vue's getFileDefault
const getFileDefault = (): PermissionItem[] => [
  { id: 0, subject_id: 0, subject_type: SUBJECT_TYPE.library_admin, permission: PERMISSION_TYPE.manage },
  { id: 0, subject_id: 0, subject_type: SUBJECT_TYPE.library_user, permission: PERMISSION_TYPE.inherit }
]

export function PermissionSetting({ onClose, className }: PermissionSettingProps) {
  const libraryStore = useLibraryStore()
  const userStore = useUserStore()

  const [defaultPermissions, setDefaultPermissions] = useState<PermissionItem[]>(getFileDefault)
  const [spaceAdminList, setSpaceAdminList] = useState<PermissionItem[]>([])
  const [spaceUserList, setSpaceUserList] = useState<PermissionItem[]>([])
  const [permissions, setPermissions] = useState<PermissionItem[]>([])

  const isLibraryPermission = (subject_type: number) => {
    return [SUBJECT_TYPE.library_admin, SUBJECT_TYPE.library_user].includes(subject_type as any)
  }

  const isSelf = (subject_id: number) => {
    return subject_id === userStore.info?.user_id
  }

  // Check if this is the last manage permission
  const isLastManagePermission = (member: PermissionItem) => {
    if (member.permission !== PERMISSION_TYPE.manage) {
      return false
    }

    const otherManageCount = permissions.filter(
      m => m.subject_id !== member.subject_id && m.permission === PERMISSION_TYPE.manage
    ).length

    return otherManageCount === 0
  }

  const loadPermission = () => {
    permissionsApi.detail({
      resource_type: RESOURCE_TYPE.file,
      resource_id: libraryStore.currentFileId
    }).then((res) => {
      setSpaceAdminList(res.team_admin)
      setSpaceUserList(res.team_member.filter(item => item.subject_type !== SUBJECT_TYPE.space_active))

      const admin = res.direct.find(item => item.subject_type === SUBJECT_TYPE.library_admin)
      const user = res.direct.find(item => item.subject_type === SUBJECT_TYPE.library_user)

      // Create new array to update state
      const newDefaults = [...defaultPermissions]
      if (admin) {
        newDefaults[0] = admin
      }
      if (user) {
        newDefaults[1] = user
      }
      setDefaultPermissions(newDefaults)

      setPermissions(
        res.direct.filter(
          item =>
            item.subject_type !== SUBJECT_TYPE.library_admin &&
            item.subject_type !== SUBJECT_TYPE.library_user
        )
      )
    })
  }

  const handleMemberConfirm = (data: { list: any[] }) => {
    const newPermissions = data.list.filter(child => {
      if (
        permissions.some(
          item => item.subject_id === child.subject_id && item.subject_type === child.subject_type
        )
      ) {
        return false
      }
      return true
    }).map(item => ({
      subject_id: item.subject_id,
      subject_type: item.subject_type,
      permission: item.permission
    }))

    permissionsApi.create(RESOURCE_TYPE.file, libraryStore.currentFileId, {
      permissions: newPermissions
    }).then(() => {
      loadPermission()
      message.success(t('status.save_success'))
    })
  }

  const handlePermissionUpdate = (index: number, value: PermissionItem) => {
    if (value.permission === PERMISSION_TYPE.inherit) {
      if (value.id) {
        permissionsApi.delete(value.id).then(() => {
          loadPermission()
        })
      }
    } else {
      if (value.id) {
        permissionsApi.update(value.id, {
          permission: value.permission
        }).then(() => {
          loadPermission()
        })
      } else {
        permissionsApi.create(RESOURCE_TYPE.file, libraryStore.currentFileId, {
          permissions: [value]
        }).then(() => {
          loadPermission()
        })
      }
    }

    const newDefaults = [...defaultPermissions]
    newDefaults[index] = value
    setDefaultPermissions(newDefaults)
  }

  const handlePermissionSelect = (permission: number, member: PermissionItem) => {
    if (member.permission === permission) return

    // Check if trying to remove last manage permission
    if (
      member.permission === PERMISSION_TYPE.manage &&
      permission !== PERMISSION_TYPE.manage &&
      isLastManagePermission(member)
    ) {
      message.warning('不能删除最后一个可管理权限，请至少保留一个管理员')
      return
    }

    if (isLibraryPermission(member.subject_type)) {
      if (member.permission === PERMISSION_TYPE.inherit) {
        if (member.id) {
          permissionsApi.delete(member.id).then(() => {
            loadPermission()
          })
        }
      } else {
        if (member.id) {
          permissionsApi.update(member.id, {
            permission: permission
          }).then(() => {
            loadPermission()
          })
        } else {
          permissionsApi.create(RESOURCE_TYPE.file, libraryStore.currentFileId, {
            permissions: [
              {
                subject_type: member.subject_type,
                subject_id: member.subject_id,
                permission: permission
              }
            ]
          }).then(() => {
            loadPermission()
            message.success(t('status.save_success'))
          })
        }
      }
    } else {
      if (permission === PERMISSION_TYPE.remove) {
        permissionsApi.delete(member.id).then(() => {
          loadPermission()
          message.success(t('status.save_success'))
        })
      } else {
        if (member.id) {
          permissionsApi.update(member.id, {
            permission: permission
          }).then(() => {
            loadPermission()
          })
        }
      }
    }
  }

  const handleClose = () => {
    onClose?.()
  }

  useEffect(() => {
    loadPermission()
  }, [])

  return (
    <div className={`overflow-hidden flex flex-col permission-setting ${className || ''}`}>
      <div className="flex-none h-14 flex items-center justify-between px-3 border-b">
        <h3 className="text-base text-[#1D1E1F]">成员与权限</h3>
        <CloseOutlined className="cursor-pointer" onClick={handleClose} />
      </div>

      <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-1">
        {/* Default permissions for library admin/user */}
        {defaultPermissions.map((permission, index) => (
          <GroupList
            key={permission.id || index}
            title={index === 0
              ? `上级知识的管理员(${spaceAdminList.length})`
              : `上级知识的成员(${spaceUserList.length})`}
            resourceType={RESOURCE_TYPE.library}
            value={permission}
            disabled={index === 0}
            onChange={(value) => handlePermissionUpdate(index, value)}
            userList={index === 0 ? spaceAdminList : spaceUserList}
          />
        ))}

        {/* Selected members list */}
        {permissions.length > 0 && (
          <>
            <div className="border-b my-1" />
            {permissions.map((member) => (
              <div
                key={member.subject_id}
                className="flex items-center justify-between rounded-md px-0.5 py-1.5"
              >
                <div className="flex items-center gap-2">
                  {member.subject_type === SUBJECT_TYPE.company_all ? (
                    <>
                      <img
                        src={getPublicPath('/images/space/group.png')}
                        alt="admin"
                        className="size-5"
                      />
                      <span className="text-sm text-[#1D1E1F]">所有成员</span>
                    </>
                  ) : (
                    <EntityDisplay
                      className="text-sm text-gray-600"
                      id={member.subject_id}
                      mode="full"
                      type={member.subject_type === SUBJECT_TYPE.user ? 'user' : 'group'}
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <RolePopover
                    value={member.permission}
                    none
                    remove
                    disabled={isSelf(member.subject_id)}
                    onChange={(permission) => handlePermissionSelect(permission, member)}
                  />
                </div>
              </div>
            ))}
          </>
        )}

        <div className="mt-2">
          <MemberSelector
            trigger={<Button type="primary">添加成员</Button>}
            onConfirm={handleMemberConfirm}
          />
        </div>
      </div>
    </div>
  )
}

export default PermissionSetting
