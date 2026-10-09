/**
 * Agent Plugin 应用语言包
 *
 * 格式：[key, zh-cn, zh-tw, en, ja]（与 shared-business 各模块语言包的 KeyRow 规范一致）
 * 通过 src/i18n.ts 的 tApp / useAppTranslation 消费。
 */

export type Lang = 'zh-cn' | 'zh-tw' | 'en' | 'ja'

/** key 行类型：[key, zh-cn, zh-tw, en, ja] */
export type AppKeyRow = readonly [string, string, string, string, string]

// ==================== Agent Plugin 翻译 ====================

const APP_KEYS: readonly AppKeyRow[] = [
  // 通用状态
  ['app.loading', '加载中...', '加載中...', 'Loading...', '読み込み中...'],
  ['app.retry', '重试', '重試', 'Retry', '再試行'],
  // 启动 / 登录流程
  ['app.missing_params', '缺少必要参数', '缺少必要參數', 'Missing required parameters', '必要なパラメータが不足しています'],
  ['app.agent_not_found', '智能体不存在', '智能體不存在', 'Agent not found', 'エージェントが見つかりません'],
  ['app.login_failed', '登录失败', '登錄失敗', 'Login failed', 'ログインに失敗しました'],
  ['app.sso_login_failed', 'SSO登录失败', 'SSO登錄失敗', 'SSO login failed', 'SSOログインに失敗しました'],
  ['app.fetch_agent_failed', '获取智能体信息失败', '獲取智能體信息失敗', 'Failed to get agent info', 'エージェント情報の取得に失敗しました'],
  // 权限
  ['app.no_agent_permission', '您没有使用该智能体的权限', '您沒有使用該智能體的權限', 'You do not have permission to use this agent', 'このエージェントを使用する権限がありません'],
  ['app.please_login_first', '请先登录', '請先登錄', 'Please log in first', '先にログインしてください'],
  // 权限范围展示（AuthTagGroup）
  ['app.use_range', '使用范围', '使用範圍', 'Access scope', '利用範囲'],
  ['app.all_members', '全部成员', '全部成員', 'All members', '全メンバー'],
]

function buildFlat(rows: readonly AppKeyRow[], langIndex: number): Record<string, string> {
  const result: Record<string, string> = {}
  for (const row of rows) {
    result[row[0]] = row[langIndex]
  }
  return result
}

export const appMessages: Record<Lang, Record<string, string>> = {
  'zh-cn': buildFlat(APP_KEYS, 1),
  'zh-tw': buildFlat(APP_KEYS, 2),
  en: buildFlat(APP_KEYS, 3),
  ja: buildFlat(APP_KEYS, 4),
}

export default appMessages
