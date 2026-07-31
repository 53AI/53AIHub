import { useState, useEffect } from 'react'
import { Button, message } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { MemberSelector } from '@/components/KMPermission/MemberSelector'
import { t } from '@/locales'
import { RolePopover } from '@/components/KMPermission/RolePopover'
import { GroupList } from '@/components/KMPermission/group-list'
import { EntityDisplay } from '@/components/EntityDisplay'
import { permissionsApi, type PermissionItem } from '@/api/modules/permissions'
import { RESOURCE_TYPE, PERMISSION_TYPE, SUBJECT_TYPE, type SubjectType } from '@/components/KMPermission/constant'
import { useUserStore } from '@/stores/modules/user'
import { getPublicPath } from '@/utils/config'
import '@/views/library/main/components/permission-setting.css'

interface WikiPermissionSettingProps {
  onClose?: () => void
  className?: string
  pageId: string
}

// Default permissions structure - matches library's getFileDefault
const getWikiPageDefault = (): PermissionItem[] => [
  { id: 0, subject_id: 0, subject_type: SUBJECT_TYPE.space_admin, permission: PERMISSION_TYPE.manage },
  { id: 0, subject_id: 0, subject_type: SUBJECT_TYPE.space_user, permission: PERMISSION_TYPE.inherit }
]

export function WikiPermissionSetting({ onClose, className, pageId }: WikiPermissionSettingProps) {
  const userStore = useUserStore()

  const [defaultPermissions, setDefaultPermissions] = useState<PermissionItem[]>(getWikiPageDefault)
  const [spaceAdminList, setSpaceAdminList] = useState<PermissionItem[]>([])
  const [spaceUserList, setSpaceUserList] = useState<PermissionItem[]>([])
  const [permissions, setPermissions] = useState<PermissionItem[]>([])

  const isLibraryPermission = (subject_type: SubjectType) => {
    return subject_type === SUBJECT_TYPE.space_admin || subject_type === SUBJECT_TYPE.space_user
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
      other => other.subject_id !== member.subject_id && other.permission === PERMISSION_TYPE.manage
    ).length

    return otherManageCount === 0
  }

  const loadPermission = () => {
    permissionsApi.detail({
      resource_type: RESOURCE_TYPE.wiki_page,
      resource_id: pageId
    }).then((res) => {
      setSpaceAdminList(res.team_admin)
      setSpaceUserList(res.team_member.filter(item => item.subject_type !== SUBJECT_TYPE.space_active))

      const admin = res.direct.find(item => item.subject_type === SUBJECT_TYPE.space_admin)
      const user = res.direct.find(item => item.subject_type === SUBJECT_TYPE.space_user)

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
            item.subject_type !== SUBJECT_TYPE.space_admin &&
            item.subject_type !== SUBJECT_TYPE.space_user
        )
      )
    }).catch((err) => {
      console.error('[WikiPermissionSetting] load permission failed:', err)
      message.error(t('status.load_fail'))
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

    permissionsApi.create(RESOURCE_TYPE.wiki_page, pageId, {
      permissions: newPermissions
    }).then(() => {
      loadPermission()
      message.success(t("status.save_success"))
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
        permissionsApi.create(RESOURCE_TYPE.wiki_page, pageId, {
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
      message.warning(t("permission.last_manage_tip"))
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
          permissionsApi.create(RESOURCE_TYPE.wiki_page, pageId, {
            permissions: [
              {
                subject_type: member.subject_type,
                subject_id: member.subject_id,
                permission: permission
              }
            ]
          }).then(() => {
            loadPermission()
            message.success(t("status.save_success"))
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
    if (pageId) {
      loadPermission()
    }
  }, [pageId])

  return (
    <div className={`overflow-hidden flex flex-col border-l border-t border-[#E6E8EB] rounded-l-lg ${className || ''}`}>
      <div className="flex-none h-14 flex items-center justify-between px-3 border-b">
        <h3 className="text-base text-[#1D1E1F]">{t("permission.member_and_role")}</h3>
        <CloseOutlined className="cursor-pointer" onClick={handleClose} />
      </div>

      <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-1">
        {/* Default permissions for library admin/user */}
        {defaultPermissions.map((permission, index) => (
          <GroupList
            key={permission.id || index}
            title={index === 0
              ? t("permission.team_space_admin", { count: spaceAdminList.length })
              : t("permission.team_space_member", { count: spaceUserList.length })}
            resourceType={RESOURCE_TYPE.wiki_page}
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
                      <span className="text-sm text-[#1D1E1F]">{t("permission.all_members")}</span>
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
            trigger={<Button type="primary">{t("permission.add_member")}</Button>}
            onConfirm={handleMemberConfirm}
          />
        </div>
      </div>
    </div>
  )
}

export default WikiPermissionSetting