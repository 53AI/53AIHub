export const RESOURCE_TYPE = {
  space: 0,
  library: 1,
  file: 2,
} as const

export const SUBJECT_TYPE = {
  user: 0,
  group: 1,
  company_all: 2,
  space_admin: 3,
  space_user: 4,
  library_admin: 5,
  library_user: 6,
  space_active: 7,
} as const

export const FILE_TYPE = {
  FOLDER: 0,
  FILE: 1,
} as const

export const PERMISSION_TYPE = {
  inherit: 999999,
  manage: 500,
  edit_all: 400,
  edit_knowledge: 300,
  view_and_export: 200,
  viewer: 100,
  public_only: 1,
  none: 0,
  remove: -1,
  loading: -999999,
} as const

export const VISIBILITY_TYPE = {
  public: 1,
  private: 0,
} as const

export const ACTION_TYPE = {
  view: 'view',
  view_and_export: 'view_and_export',
  edit_knowledge: 'edit_knowledge',
  edit_all: 'edit_all',
  manage: 'manage',
} as const

export type ResourceType = (typeof RESOURCE_TYPE)[keyof typeof RESOURCE_TYPE]
export type SubjectType = (typeof SUBJECT_TYPE)[keyof typeof SUBJECT_TYPE]
export type FileType = (typeof FILE_TYPE)[keyof typeof FILE_TYPE]
export type PermissionType = (typeof PERMISSION_TYPE)[keyof typeof PERMISSION_TYPE]
export type VisibilityType = (typeof VISIBILITY_TYPE)[keyof typeof VISIBILITY_TYPE]
export type ActionType = (typeof ACTION_TYPE)[keyof typeof ACTION_TYPE]
