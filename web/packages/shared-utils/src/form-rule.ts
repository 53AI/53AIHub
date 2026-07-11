export type ValidatorOpts = {
  rule?: unknown
  value?: unknown
  callback: (err?: string | Error) => void
  message?: string
  min?: number
  max?: number
}

const t = (key: string) =>
  (typeof window !== 'undefined' && (window as any).$t ? (window as any).$t(key) : key)

export function textValidator(opts: ValidatorOpts = {} as ValidatorOpts) {
  const { value, callback, message = 'form_input_placeholder' } = opts
  const v = String(value ?? '').trim()
  if (!v) return callback(t(message))
  callback()
}

export function linkValidator(opts: ValidatorOpts = {} as ValidatorOpts) {
  const { value, callback, message = 'form_input_placeholder' } = opts
  const v = String(value ?? '').trim()
  if (!v) return callback(t(message))
  if (!/^(https?:\/\/)?((([\w.-]+)(\.[\w.-]+)+)|((\d{1,3}\.){3}\d{1,3}))(:\d+)?([\/#\?].*)?$/.test(v))
    return callback(t('form_link_validator'))
  callback()
}

export function accountValidator(opts: ValidatorOpts = {} as ValidatorOpts) {
  const { value, callback, message = 'form_input_placeholder' } = opts
  const v = String(value ?? '').trim()
  if (/[\s]/.test(v)) return callback(t('form_account_validator'))
  if (!v) return callback(t(message))
  callback()
}

export function mobileValidator(opts: ValidatorOpts = {} as ValidatorOpts) {
  const { value, callback, message = 'form_input_placeholder' } = opts
  const v = String(value ?? '').trim()
  if (!v) return callback(t(message))
  if (!/^(\+86)?(13[0-9]|14[0-9]|15[0-9]|16[0-9]|17[0-9]|18[0-9]|19[0-9])\d{8}$/.test(v))
    return callback(t('form_mobile_validator'))
  callback()
}

export function emailValidator(opts: ValidatorOpts = {} as ValidatorOpts) {
  const { value, callback, message = 'form_input_placeholder' } = opts
  const v = String(value ?? '').trim()
  if (!v) return callback(t(message))
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v))
    return callback(t('form_email_validator'))
  callback()
}

export function mobileOrEmailValidator(opts: ValidatorOpts = {} as ValidatorOpts) {
  const { value, callback, message = 'form_input_placeholder' } = opts
  const v = String(value ?? '').trim()
  if (!v) return callback(t(message))
  if (
    !/^(13[0-9]|14[0-9]|15[0-9]|16[0-9]|17[0-9]|18[0-9]|19[0-9])\d{8}$/.test(v) &&
    !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v)
  )
    return callback(t('form_mobile_or_email_validator'))
  callback()
}

export function passwordValidator(opts: ValidatorOpts = {} as ValidatorOpts) {
  const { value, callback, message = 'form_input_placeholder' } = opts
  const v = String(value ?? '').trim()
  if (/[\u4e00-\u9fa5]/.test(v) || /[\s]/.test(v))
    return callback(t('form_password_validator'))
  if (!v) return callback(t(message))
  callback()
}

export function urlValidator(opts: ValidatorOpts = {} as ValidatorOpts) {
  const { value, callback, message = 'form_input_placeholder' } = opts
  const v = String(value ?? '').trim()
  if (!v) return callback(t(message))
  if (
    !/^(https?:\/\/)?([\w.-]+)(\.[\w.-]+)+(:(0|([1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])))?([\/#\?].*)?$/.test(
      v,
    )
  )
    return callback(t('form_url_validator'))
  callback()
}

export function pathValidator(opts: ValidatorOpts = {} as ValidatorOpts) {
  const { value, callback, message = 'form_input_placeholder' } = opts
  const v = String(value ?? '').trim()
  if (!v) return callback(t(message))
  if (!/^(\/[\w-]+)+$/.test(v)) return callback(t('form_path_validator'))
  callback()
}

export function imageValidator(opts: ValidatorOpts = {} as ValidatorOpts) {
  const { value, callback, message = 'form_input_placeholder' } = opts
  const v = String(value ?? '').trim()
  if (!v) return callback(t(message))
  if (!/^https?:\/\/.+\.(jpg|jpeg|png|gif|bmp|webp)$/.test(v))
    return callback(t('form_image_validator'))
  callback()
}

export function variableValidator(opts: ValidatorOpts = {} as ValidatorOpts) {
  const { value, callback, message = 'form_input_placeholder' } = opts
  const v = String(value ?? '').trim()
  if (!v) return callback(t(message))
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v))
    return callback(t('form_variable_validator'))
  callback()
}

export function portValidator(opts: ValidatorOpts = {} as ValidatorOpts) {
  const { value, callback, message = 'form_input_placeholder' } = opts
  const v = String(value ?? '').trim()
  if (!v) return callback(t(message))
  if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 65535)
    return callback(t('form_port_validator'))
  callback()
}

export function numberValidator(opts: ValidatorOpts = {} as ValidatorOpts) {
  const { value, callback, message = 'form_input_placeholder', min = 0, max = 99999999 } = opts
  const v = String(value ?? '').trim()
  if (!v) return callback(t(message))
  if (!/^\d+$/.test(v)) return callback(t(message))
  if (Number(v) < min || Number(v) > max) return callback(t(message))
  callback()
}

// 兼容 Ant Design Form.Rule 类型
export type RuleItem = {
  type?: 'string' | 'number' | 'boolean' | 'url' | 'email'
  validator: (rule: unknown, value: unknown, callback: (err?: string | Error) => void) => void
  trigger?: 'blur' | 'change' | ('blur' | 'change')[] | string
}

export function generateInputRules(opts: {
  message?: string
  trigger?: ('blur' | 'change')[]
  validator?: string[]
  min?: number
  max?: number
} = {}): RuleItem[] {
  const {
    message = 'form_input_placeholder',
    trigger = ['blur', 'change'],
    validator = ['text'],
    min = 0,
    max = 99999999,
  } = opts
  const rules: RuleItem[] = []

  if (validator.includes('text'))
    rules.push({
      validator: (rule, value, callback) =>
        textValidator({ rule, value, callback, message }),
      trigger,
    })
  if (validator.includes('port'))
    rules.push({
      validator: (rule, value, callback) =>
        portValidator({ rule, value, callback, message }),
      trigger,
    })
  if (validator.includes('account'))
    rules.push({
      validator: (rule, value, callback) =>
        accountValidator({ rule, value, callback, message }),
      trigger,
    })
  if (validator.includes('link'))
    rules.push({
      validator: (rule, value, callback) =>
        linkValidator({ rule, value, callback, message }),
      trigger,
    })
  if (validator.includes('mobile') && validator.includes('email'))
    rules.push({
      validator: (rule, value, callback) =>
        mobileOrEmailValidator({ rule, value, callback, message }),
      trigger,
    })
  else if (validator.includes('mobile'))
    rules.push({
      validator: (rule, value, callback) =>
        mobileValidator({ rule, value, callback, message }),
      trigger,
    })
  else if (validator.includes('email'))
    rules.push({
      validator: (rule, value, callback) =>
        emailValidator({ rule, value, callback, message }),
      trigger,
    })
  if (validator.includes('password'))
    rules.push({
      validator: (rule, value, callback) =>
        passwordValidator({ rule, value, callback, message }),
      trigger,
    })
  if (validator.includes('url'))
    rules.push({
      validator: (rule, value, callback) =>
        urlValidator({ rule, value, callback, message }),
      trigger,
    })
  if (validator.includes('path'))
    rules.push({
      validator: (rule, value, callback) =>
        pathValidator({ rule, value, callback, message }),
      trigger,
    })
  if (validator.includes('image'))
    rules.push({
      validator: (rule, value, callback) =>
        imageValidator({ rule, value, callback, message: 'form_upload_placeholder' }),
      trigger,
    })
  if (validator.includes('variable'))
    rules.push({
      validator: (rule, value, callback) =>
        variableValidator({ rule, value, callback, message }),
      trigger,
    })
  if (validator.includes('number'))
    rules.push({
      validator: (rule, value, callback) =>
        numberValidator({ rule, value, callback, message, min, max }),
      trigger,
    })
  return rules
}
