import { SUBJECT_TYPE, PERMISSION_TYPE } from './constant'

export const getLibraryDefault = () => {
  return [
    {
      subject_type: SUBJECT_TYPE.space_admin,
      subject_id: 0,
      permission: PERMISSION_TYPE.inherit
    },
    {
      subject_type: SUBJECT_TYPE.space_user,
      subject_id: 0,
      permission: PERMISSION_TYPE.inherit
    }
  ]
}

export const getFileDefault = () => {
  return [
    {
      subject_type: SUBJECT_TYPE.library_admin,
      subject_id: 0,
      permission: PERMISSION_TYPE.manage
    },
    {
      subject_type: SUBJECT_TYPE.library_user,
      subject_id: 0,
      permission: PERMISSION_TYPE.inherit
    }
  ]
}