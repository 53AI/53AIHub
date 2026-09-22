import { PERMISSION_TYPE, type PermissionType } from "./constant";

/**
 * 权限值 → 展示文案（标题）。
 * 下拉选择器（RolePopover / PermissionSelector）与只读标签共用此处，保持单一来源。
 * 注意：inherit 在团队空间场景显示为"继承团队空间权限"，由调用方按 resourceType 覆盖。
 */
export const PERMISSION_LABEL: Record<PermissionType, string> = {
  [PERMISSION_TYPE.inherit]: "继承上级权限",
  [PERMISSION_TYPE.manage]: "可管理",
  [PERMISSION_TYPE.edit_all]: "可编辑知识&语料",
  [PERMISSION_TYPE.edit_knowledge]: "可编辑知识",
  [PERMISSION_TYPE.view_and_export]: "可查看/导出",
  [PERMISSION_TYPE.viewer]: "仅查看",
  [PERMISSION_TYPE.public_only]: "",
  [PERMISSION_TYPE.none]: "无权限",
  [PERMISSION_TYPE.remove]: "移除",
  [PERMISSION_TYPE.loading]: "",
};

/** 权限值 → 说明文案（下拉项副标题；只读标签场景用不到）。 */
export const PERMISSION_DESC: Record<PermissionType, string> = {
  [PERMISSION_TYPE.inherit]: "继承上级权限",
  [PERMISSION_TYPE.manage]: "可编辑/下载/导出，添加成员",
  [PERMISSION_TYPE.edit_all]: "可编辑知识和语料",
  [PERMISSION_TYPE.edit_knowledge]: "编辑知识，不可编辑语料",
  [PERMISSION_TYPE.view_and_export]: "可查看及下载导出",
  [PERMISSION_TYPE.viewer]: "仅查看，不可下载导出",
  [PERMISSION_TYPE.public_only]: "",
  [PERMISSION_TYPE.none]: "无权限，不可见",
  [PERMISSION_TYPE.remove]: "",
  [PERMISSION_TYPE.loading]: "",
};

/** 取权限标签文案；未知/空值返回空串（标签场景据此隐藏）。 */
export const getPermissionLabel = (permission?: number | null): string =>
  permission == null ? "" : PERMISSION_LABEL[permission as PermissionType] ?? "";
