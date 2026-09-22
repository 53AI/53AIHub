/**
 * 图形验证码（人机校验）模块语言包
 *
 * <CaptchaModal /> 所需的全部文案集中在这里维护，避免各应用重复定义。
 *
 * 两种消费方式：
 * 1. 应用已有自己的 i18n：把 captchaMessages 合并进应用的语言包，
 *    然后把应用的 t 直接传给 <CaptchaModal t={t} />；
 * 2. 无应用级 i18n 或独立使用（如 shared-business 内部）：用
 *    createCaptchaT(lang) 生成 t 传给组件。
 */

export type CaptchaLang = 'zh-cn' | 'zh-tw' | 'en' | 'ja'

type KeyRow = readonly [key: string, zhCN: string, zhTW: string, en: string, ja: string]

/** key, 简体中文, 繁體中文, English, 日本語 */
const CAPTCHA_KEYS: readonly KeyRow[] = [
  ['captcha.title', '安全验证', '安全驗證', 'Security Verification', 'セキュリティ認証'],
  ['captcha.tip', '请输入图片中的字符', '請輸入圖片中的字符', 'Enter the characters shown in the image', '画像に表示された文字を入力してください'],
  ['captcha.placeholder', '请输入图形验证码', '請輸入圖形驗證碼', 'Enter the image code', '画像認証コードを入力してください'],
  ['captcha.refresh', '换一张', '換一張', 'Change', '画像を変更'],
  ['captcha.required', '请输入图形验证码', '請輸入圖形驗證碼', 'Please enter the image code', '画像認証コードを入力してください'],
  ['captcha.error', '图形验证码错误或已过期，请重新输入', '圖形驗證碼錯誤或已過期，請重新輸入', 'Invalid or expired captcha. Please try again', '画像認証コードが無効または期限切れです。もう一度入力してください'],
  ['captcha.load_fail', '图形验证码加载失败，请点击图片重试', '圖形驗證碼載入失敗，請點擊圖片重試', 'Failed to load the captcha. Click the image to retry', '画像認証コードの読み込みに失敗しました。画像をクリックして再試行してください'],
  ['captcha.expired', '已过期', '已過期', 'Expired', '期限切れ'],
  ['captcha.tap_refresh', '点击刷新', '點擊刷新', 'Tap to refresh', 'タップして更新'],
  ['captcha.send_fail', '请输入正确的字符', '請輸入正確的字元', 'Please enter the correct characters', '正しい文字を入力してください'],
  ['captcha.cancel', '取消', '取消', 'Cancel', 'キャンセル'],
  ['captcha.confirm', '确认', '確認', 'Confirm', '確認']
]

/** 按 dot 路径把值设置到嵌套对象上 */
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

/** 把 [key, ...translations] 行转成嵌套语言对象 */
function toNested(rows: readonly KeyRow[], langIndex: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const row of rows) {
    setByPath(obj, row[0], row[langIndex])
  }
  return obj
}

/** 各语言文案（嵌套结构，可直接 deepMerge 进应用语言包） */
export const captchaMessages = {
  'zh-cn': toNested(CAPTCHA_KEYS, 1),
  'zh-tw': toNested(CAPTCHA_KEYS, 2),
  en: toNested(CAPTCHA_KEYS, 3),
  ja: toNested(CAPTCHA_KEYS, 4)
} as const

/** 按 dot 路径读取嵌套对象中的值 */
function getByPath(obj: Record<string, unknown> | undefined, path: string): unknown {
  if (!obj) return undefined
  let cur: unknown = obj
  for (const p of path.split('.')) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p]
    } else {
      return undefined
    }
  }
  return cur
}

/** 生成 captcha.* 键的翻译函数（供 shared-business 内部或独立场景使用） */
export function createCaptchaT(lang: CaptchaLang = 'zh-cn'): (key: string) => string {
  return (key: string) => {
    const raw = getByPath(captchaMessages[lang] as Record<string, unknown>, key)
    return (typeof raw === 'string' && raw) || key
  }
}
