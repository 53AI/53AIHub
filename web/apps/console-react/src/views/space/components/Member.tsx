import { Radio, Button } from 'antd'
import { EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons'
import { MemberSelector } from '@/components/Permission/member-selector'
import PermissionSelector from '@/components/Permission/selector'
import { EntityDisplay } from '@/components/EntityDisplay'
import {
    PERMISSION_TYPE,
    SUBJECT_TYPE,
    VISIBILITY_TYPE,
    type PermissionType,
    type SubjectType,
} from '@/components/Permission/constant'
import type { SpaceCreateRequest } from '@/api/modules/spaces/types'
import { useUserStore } from '@/stores/modules/user'
import { t } from '@/locales'
import { getRealPath } from '@/utils/config'

export interface MemberProps {
  formData: SpaceCreateRequest
  ownerId?: number
  type?: 'detail' | 'create'
  onVisibilityChange?: (visibility: number) => void
  onPermissionsChange?: (permissions: SpaceCreateRequest['permissions']) => void
}

export function Member({
  formData,
  ownerId,
  type = 'create',
  onVisibilityChange,
  onPermissionsChange,
}: MemberProps) {
  const userStore = useUserStore()
  const userId = userStore.info.user_id

  const isSelf = (subjectId: number) => {
    return subjectId === Number(userId)
  }

  const isCreator = (subjectId: number) => {
    return subjectId === ownerId
  }

  const handleMemberConfirm = (data: {
    list: { subject_id: number; subject_type: SubjectType; permission: PermissionType }[]
  }) => {
    const newPermissions = [...formData.permissions]
    data.list.forEach((member) => {
      const existIndex = newPermissions.findIndex(
        (item) => item.subject_id === member.subject_id && item.subject_type === member.subject_type
      )
      if (existIndex !== -1) {
        const exist = newPermissions[existIndex]
        if (isSelf(exist.subject_id)) {
          return
        }
        newPermissions[existIndex] = { ...exist, permission: member.permission }
        return
      }

      newPermissions.push({
        subject_id: member.subject_id,
        permission: member.permission,
        subject_type: member.subject_type,
      })
    })
    onPermissionsChange?.(newPermissions)
  }

  const handlePermissionSelect = (permission: PermissionType, index: number) => {
    if (permission === PERMISSION_TYPE.remove) {
      const newPermissions = [...formData.permissions]
      newPermissions.splice(index, 1)
      onPermissionsChange?.(newPermissions)
    }
  }

  const handlePermissionChange = (permission: PermissionType, index: number) => {
    const newPermissions = [...formData.permissions]
    newPermissions[index] = { ...newPermissions[index], permission }
    onPermissionsChange?.(newPermissions)
  }

  return (
    <>
      {/* 成员与权限 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-primary">
            {type === 'detail' ? t('common.member') : t('space.member_and_permission')}
          </span>
          <MemberSelector onConfirm={handleMemberConfirm}>
            <Button type="link" className="!p-0">
              +{t('action_add')}
            </Button>
          </MemberSelector>
        </div>
        <div className="w-full p-3 flex flex-col bg-[#F7F8FA] rounded-xl">
          <div className="max-h-52 overflow-y-auto">
            {formData.permissions.map((member, index) => (
              <div
                key={`${member.subject_type}-${member.subject_id}`}
                className="flex items-center justify-between rounded-md py-1.5"
              >
                <div className="flex items-center gap-2">
                  {member.subject_type === SUBJECT_TYPE.company_all ? (
                    <>
                      <img
                        src={getRealPath('/images/space/peoples.png')}
                        alt={t('space.all_members')}
                        className="w-5 h-5"
                      />
                      <span className="text-sm text-primary">{t('space.all_members')}</span>
                    </>
                  ) : (
                    <EntityDisplay
                      id={member.subject_id}
                      type={member.subject_type === SUBJECT_TYPE.group ? 'group' : 'user'}
                      mode="full"
                      avatarSize={20}
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <PermissionSelector
                    value={member.permission}
                    onChange={(permission) => handlePermissionChange(permission, index)}
                    onSelect={(permission) => handlePermissionSelect(permission, index)}
                    remove={!isSelf(member.subject_id)}
                    none={true}
                    disabled={isSelf(member.subject_id) || isCreator(member.subject_id)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 可见性设置 */}
      <div className="mb-4">
        <div className="text-sm text-primary mb-2">{t('space.visibility_setting')}</div>
        <div className="grid grid-cols-2 gap-3">
          <div
            className={`rounded-md border p-3 relative cursor-pointer ${
              formData.visibility === VISIBILITY_TYPE.public
                ? 'bg-[#2563EB14] border-[#2563EB]'
                : ''
            }`}
            onClick={() => onVisibilityChange?.(VISIBILITY_TYPE.public)}
          >
            <div className="mb-2 flex items-center gap-1">
              <EyeOutlined style={{ color: '#999', fontSize: 16 }} />
              <span className="text-sm text-primary">{t('space.visible')}</span>
            </div>
            <div className="text-xs text-hint">{t('space.non_space_member_can_view')}</div>
            <div className="absolute top-1 right-1">
              <Radio
                checked={formData.visibility === VISIBILITY_TYPE.public}
                value={VISIBILITY_TYPE.public}
              />
            </div>
          </div>
          <div
            className={`rounded-md border p-3 relative cursor-pointer ${
              formData.visibility === VISIBILITY_TYPE.private
                ? 'bg-[#2563EB14] border-[#2563EB]'
                : ''
            }`}
            onClick={() => onVisibilityChange?.(VISIBILITY_TYPE.private)}
          >
            <div className="mb-2 flex items-center gap-1">
              <EyeInvisibleOutlined style={{ color: '#999', fontSize: 16 }} />
              <span className="text-sm text-primary">{t('space.invisible')}</span>
            </div>
            <div className="text-xs text-hint">{t('space.only_space_member_can_view')}</div>
            <div className="absolute top-1 right-1">
              <Radio
                checked={formData.visibility === VISIBILITY_TYPE.private}
                value={VISIBILITY_TYPE.private}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default Member
