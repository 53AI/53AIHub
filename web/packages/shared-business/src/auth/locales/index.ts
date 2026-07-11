/**
 * Auth 模块语言包
 */

/** 按 dot 路径设置嵌套对象上的值 */
function setByPath(obj: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split('.')
  const last = parts.pop()!
  let cur: Record<string, unknown> = obj
  for (const p of parts) {
    if (!(p in cur) || typeof cur[p] !== 'object') cur[p] = {}
    cur = cur[p] as Record<string, unknown>
  }
  cur[last] = value
}

type FlatMessages = Record<string, string>

function toNested(flat: FlatMessages): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(flat)) {
    setByPath(obj, key, val)
  }
  return obj
}

type KeyRow = readonly [string, string, string, string, string]

function buildFlatMessages(rows: readonly KeyRow[], langIndex: number): FlatMessages {
  const result: FlatMessages = {}
  for (const row of rows) {
    result[row[0]] = row[langIndex]
  }
  return result
}

// ==================== Auth 翻译 ====================

const AUTH_KEYS: readonly KeyRow[] = [
  // 登录方式
  ['auth.login', '登录', '登錄', 'Login', 'ログイン'],
  ['auth.login_success', '登录成功', '登錄成功', 'Login successful', 'ログイン成功'],
  ['auth.login_failed', '登录失败', '登錄失敗', 'Login failed', 'ログイン失敗'],
  ['auth.logout', '退出登录', '退出登錄', 'Logout', 'ログアウト'],
  ['auth.password_login', '账号登录', '帳號登錄', 'Account login', 'アカウントログイン'],
  ['auth.password_login_title', '密码登录', '密碼登入', 'Password Login', 'パスワードでログイン'],
  ['auth.message_login', '短信登录', '短信登錄', 'SMS login', 'SMSログイン'],
  ['auth.message_login_title', '短信登录', '簡訊登入', 'Message Login', 'SMSログイン'],
  ['auth.wechat_login', '微信登录', '微信登錄', 'WeChat login', '微信ログイン'],
  ['auth.wechat_login_title', '微信登录', '微信登入', 'WeChat Login', 'WeChatログイン'],
  ['auth.other_login_way', '其他登录方式', '其他登錄方式', 'Other login methods', '他のログイン方法'],
  // 表单字段
  ['auth.account', '账号', '帳號', 'Account', 'アカウント'],
  ['auth.mobile', '手机号', '手機號', 'Mobile', '携帯番号'],
  ['auth.password', '密码', '密碼', 'Password', 'パスワード'],
  ['auth.verify_code', '验证码', '驗證碼', 'Verify code', '確認コード'],
  ['auth.input_placeholder', '请输入', '請輸入', 'Please enter', '入力してください'],
  ['auth.mobile_format_error', '手机号格式不正确', '手機號格式不正確', 'Invalid mobile format', '携帯番号の形式が正しくありません'],
  ['auth.get_code', '获取验证码', '獲取驗證碼', 'Get code', 'コードを取得'],
  ['auth.code_sent', '验证码已发送', '驗證碼已發送', 'Code sent', '確認コードを送信しました'],
  ['auth.code_send_failed', '验证码发送失败', '驗證碼發送失敗', 'Failed to send code', '確認コードの送信に失敗しました'],
  // SSO
  ['auth.sso_processing', '正在验证登录...', '正在驗證登錄...', 'Verifying login...', 'ログインを確認中...'],
  ['auth.sso_success', 'SSO 登录成功', 'SSO 登錄成功', 'SSO login successful', 'SSOログイン成功'],
  ['auth.sso_failed', 'SSO 登录失败', 'SSO 登錄失敗', 'SSO login failed', 'SSOログイン失敗'],
  ['auth.sso_token_invalid', 'SSO Token 无效', 'SSO Token 無效', 'Invalid SSO token', 'SSOトークンが無効'],
]

const zhCN = buildFlatMessages(AUTH_KEYS, 1)
const zhTW = buildFlatMessages(AUTH_KEYS, 2)
const en = buildFlatMessages(AUTH_KEYS, 3)
const ja = buildFlatMessages(AUTH_KEYS, 4)

export const authMessages = {
  'zh-cn': toNested(zhCN),
  'zh-tw': toNested(zhTW),
  en: toNested(en),
  ja: toNested(ja),
}

export default authMessages