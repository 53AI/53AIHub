type ValidatorFn = (value: string, message: string) => string | null

type ValidationRule = {
  validator: (rule: unknown, value: unknown, callback: (error?: Error) => void) => void
  trigger: string[]
}

const t = (key: string) =>
  typeof window !== 'undefined' && (window as any).$t ? (window as any).$t(key) : key

const createValidator = (validatorFn: ValidatorFn) => {
  return ({
    value,
    callback,
    message,
  }: {
    value: unknown
    callback: (error?: Error) => void
    message: string
  }): void => {
    const trimmedValue = String(value ?? '').trim()
    const error = validatorFn(trimmedValue, message)
    callback(error ? new Error(error) : undefined)
  }
}

const validators = {
  required: (value: string, message: string) => (!value ? message : null),
  link: (value: string, message: string) => {
    if (!value) return message
    return /^(https?:\/\/)?((([\w.-]+)(\.[\w.-]+)+)|((\d{1,3}\.){3}\d{1,3}))(:\d+)?([\/#\?].*)?$/.test(
      value,
    )
      ? null
      : t('form_link_validator')
  },
  mobile: (value: string, message: string) => {
    if (!value) return message
    return /^(\+86)?(13[0-9]|14[0-9]|15[0-9]|16[0-9]|17[0-9]|18[0-9]|19[0-9])\d{8}$/.test(value)
      ? null
      : t('form_mobile_validator')
  },
  email: (value: string, message: string) => {
    if (!value) return message
    return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)
      ? null
      : t('form_email_validator')
  },
  mobileOrEmail: (value: string, message: string) => {
    if (!value) return message
    const mobile = /^(13[0-9]|14[0-9]|15[0-9]|16[0-9]|17[0-9]|18[0-9]|19[0-9])\d{8}$/.test(value)
    const email = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)
    return mobile || email ? null : t('form_mobile_or_email_validator')
  },
  password: (value: string, message: string) => {
    if (!value) return message
    return /[\u4e00-\u9fa5\s]/.test(value) ? t('form_password_validator') : null
  },
  url: (value: string, message: string) => {
    if (!value) return message
    return /^(https?:\/\/)?([\w.-]+)(\.[\w.-]+)+([\/#\?].*)?$/.test(value)
      ? null
      : t('form_url_validator')
  },
  path: (value: string, message: string) => {
    if (!value) return message
    return /^(\/[\w-]+)+$/.test(value) ? null : t('form_path_validator')
  },
  image: (value: string, message: string) => {
    if (!value) return message
    return /^https?:\/\/.+\.(jpg|jpeg|png|gif|bmp|webp)$/.test(value)
      ? null
      : t('form_image_validator')
  },
  variable: (value: string, message: string) => {
    if (!value) return message
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value) ? null : t('form_variable_validator')
  },
} as const

export type ValidatorType = keyof typeof validators

export const textValidator = createValidator(validators.required)
export const linkValidator = createValidator(validators.link)
export const mobileValidator = createValidator(validators.mobile)
export const emailValidator = createValidator(validators.email)
export const mobileOrEmailValidator = createValidator(validators.mobileOrEmail)
export const passwordValidator = createValidator(validators.password)
export const urlValidator = createValidator(validators.url)
export const pathValidator = createValidator(validators.path)
export const imageValidator = createValidator(validators.image)
export const variableValidator = createValidator(validators.variable)

const defaultMessage = () =>
  typeof window !== 'undefined' && (window as any).$t
    ? (window as any).$t('form_input_placeholder')
    : 'form_input_placeholder'

export function generateFormRules(opts: {
  message?: string
  trigger?: string[]
  validator?: string[]
} = {}): ValidationRule[] {
  const {
    message = defaultMessage(),
    trigger = ['blur', 'change'],
    validator = ['required'],
  } = opts
  const rules: ValidationRule[] = []
  validator.forEach(v => {
    const fn = validators[v as ValidatorType]
    if (fn) {
      rules.push({
        validator: (rule: unknown, value: unknown, callback: (error?: Error) => void) => {
          const err = fn(String(value ?? '').trim(), message)
          callback(err ? new Error(err) : undefined)
        },
        trigger,
      })
    }
  })
  return rules
}
