/**
 * Recording Template 模块语言包
 *
 * 在 shared-business 内维护，各端合并使用
 * 四种语言：zh-cn, zh-tw, en, ja
 */
import { buildMessages, type KeyRow } from '../../locales'

const RECORDING_TEMPLATE_KEYS: readonly KeyRow[] = [
  ['recording_template.empty', '暂无数据', '暫無數據', 'No data', 'データなし'],
  ['recording_template.edit', '编辑', '編輯', 'Edit', '編集'],
  ['recording_template.add', '添加', '添加', 'Add', '追加'],
  ['recording_template.delete', '删除', '刪除', 'Delete', '削除'],
  ['recording_template.confirm_delete_title', '确认删除', '確認刪除', 'Confirm Delete', '削除確認'],
  ['recording_template.confirm_delete_content', '确定要删除模板"{{name}}"吗？', '確定要刪除模板"{{name}}"嗎？', 'Delete template "{{name}}"?', 'テンプレート"{{name}}"を削除しますか？'],
  ['recording_template.confirm_delete_ok', '确定', '確定', 'Confirm', '確認'],
  ['recording_template.confirm_delete_cancel', '取消', '取消', 'Cancel', 'キャンセル'],
  ['recording_template.total', '共有 {{total}} 个', '共有 {{total}} 個', 'Total {{total}}', '合計 {{total}}'],
  ['recording_template.add_group', '添加', '添加', 'Add', '追加'],
  ['recording_template.group', '管理', '分組', 'Group', 'グループ'],
] as const

export const recordingTemplateMessages = buildMessages(RECORDING_TEMPLATE_KEYS)