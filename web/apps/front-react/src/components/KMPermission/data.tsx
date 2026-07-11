// Permission data utilities and constants
export * from './constant'

// Additional data exports if needed
export const PERMISSION_LABELS = {
  none: '无权限',
  viewer: '查看',
  editor: '编辑',
  manage: '管理',
  owner: '所有者',
}

export const PERMISSION_LEVELS = {
  none: 0,
  viewer: 1,
  editor: 2,
  manage: 3,
  owner: 4,
}