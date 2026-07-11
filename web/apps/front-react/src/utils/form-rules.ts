// 验证器函数类型
type ValidatorFn = (value: string, message: string, repeatValue?: string) => string | null

// 验证规则类型
type ValidationRule = {
  validator: (rule: unknown, value: unknown, callback: (error?: Error) => void) => void
  trigger: string[]
  required: boolean
}

// 基础验证器工厂函数
const createValidator = (validatorFn: ValidatorFn) => {
  return ({
    value,
    callback,
    message,
    repeatValue,
  }: {
    value: unknown
    callback: (error?: Error) => void
    message: string
    repeatValue?: string
  }): void => {
    const trimmedValue = String(value || '').trim()
    const error = validatorFn(trimmedValue, message, repeatValue)
    callback(error ? new Error(error) : undefined)
  }
}

// 各种验证器实现
const validators = {
  // 必填验证
  required: (value: string, message: string) => (!String(value || '').trim() ? message : null),

  // 链接验证
  link: (value: string, message: string) => {
    if (!value) return message
    const pattern =
      /^(https?:\/\/)?((([\w.-]+)(\.[\w.-]+)+)|((\d{1,3}\.){3}\d{1,3}))(:\d+)?([\/#\?].*)?$/
    return pattern.test(value) ? null : '请输入有效的链接地址'
  },

  // 手机号验证
  mobile: (value: string, message: string) => {
    if (!value) return message
    const pattern = /^(\+86)?(13[0-9]|14[0-9]|15[0-9]|16[0-9]|17[0-9]|18[0-9]|19[0-9])\d{8}$/
    return pattern.test(value) ? null : '请输入有效的手机号'
  },

  // 邮箱验证
  email: (value: string, message: string) => {
    if (!value) return message
    const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    return pattern.test(value) ? null : '请输入有效的邮箱地址'
  },

  // 手机号或邮箱验证
  mobileOrEmail: (value: string, message: string) => {
    if (!value) return message
    const mobilePattern = /^(13[0-9]|14[0-9]|15[0-9]|16[0-9]|17[0-9]|18[0-9]|19[0-9])\d{8}$/
    const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    return mobilePattern.test(value) || emailPattern.test(value)
      ? null
      : '请输入有效的手机号或邮箱'
  },

  // 密码验证
  password: (value: string, message: string) => {
    if (!value) return message
    if (value.length < 8 || value.length > 20) return '密码长度为8-20位'
    return null
  },

  // URL验证
  url: (value: string, message: string) => {
    if (!value) return message
    const pattern = /^(https?:\/\/)?([\w.-]+)(\.[\w.-]+)+([\/#\?].*)?$/
    return pattern.test(value) ? null : '请输入有效的URL'
  },

  // 路径验证
  path: (value: string, message: string) => {
    if (!value) return message
    const pattern = /^(\/[\w-]+)+$/
    return pattern.test(value) ? null : '请输入有效的路径'
  },

  // 图片URL验证
  image: (value: string, message: string) => {
    if (!value) return message
    const pattern = /^https?:\/\/.+\.(jpg|jpeg|png|gif|bmp|webp)$/
    return pattern.test(value) ? null : '请输入有效的图片URL'
  },

  // 变量名验证
  variable: (value: string, message: string) => {
    if (!value) return message
    const pattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/
    return pattern.test(value) ? null : '请输入有效的变量名'
  },


  // 密码确认验证
  passwordConfirm: (value: string, message: string, originalPassword?: string) => {
    if (!value) return message
    return value === originalPassword ? null : '两次输入的密码不一致'
  },
} as const

export type ValidatorType = keyof typeof validators


export { validators }
// 导出各个验证器
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
export const passwordConfirmValidator = createValidator(validators.passwordConfirm)

// 生成表单验证规则
export const generateFormRules = ({
  message = '请输入内容',
  trigger = ['blur', 'change'],
  validator = ['required'],
  required = true,
  originalVal = ''
}: {
  message?: string
  trigger?: string[]
  validator?: ValidatorType[]
  required?: boolean
  originalVal?: string
} = {}): ValidationRule[] => {
  const rules: ValidationRule[] = []

  // 处理验证器
  validator.forEach(v => {
    const fn = validators[v as ValidatorType]
    if (fn) {
      rules.push({
        validator: (rule: unknown, value: unknown, callback: (error?: Error) => void) => {
          const err = fn(String(value || '').trim(), message, originalVal)
          callback(err ? new Error(err) : undefined)
        },
        trigger,
        required,
      })
    }
  })

  return rules
}



export const getPasswordRules = () => {
  return {
    validator: (rule: any, value: string) => {
      if (!value || value.length < 8 || value.length > 20) {
        return Promise.reject('密码长度为8-20位')
      }
      if (/[\u4e00-\u9fa5]/.test(value)) {
        return Promise.reject('密码不能包含中文')
      }
      return Promise.resolve()
    },
    trigger: 'blur'
  }
}

export const getMobileRules = () => {
  return {
    validator: (rule: any, value: string) => {
      // 手机号正则（中国大陆手机号）
      const phoneRegex = /^1[3-9]\d{9}$/

      if (!phoneRegex.test(value)) {
        return Promise.reject('请输入正确的手机号格式')
      }
      return Promise.resolve()
    },
    trigger: 'blur'
  }
}

export const getEmailRules = () => {
  return {
    validator: (rule: any, value: string) => {
      if (!value) {
        return Promise.reject('请输入邮箱地址')
      }
      // 邮箱正则
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
      if (!emailRegex.test(value)) {
        return Promise.reject('请输入正确的邮箱格式')
      }
      return Promise.resolve()
    },
    trigger: 'blur'
  }
}

export const getAccountOrEmailRules = () => {
  return {
    validator: (rule: any, value: string) => {
      if (!value) {
        return Promise.reject('请输入账号或邮箱')
      }
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
      if (emailRegex.test(value)) {
        return Promise.resolve()
      }
      const mobileRegex = /^1[3-9]\d{9}$/
      if (mobileRegex.test(value)) {
        return Promise.resolve()
      }
      return Promise.reject('请输入正确的账号格式')
    },
    trigger: 'blur'
  }
}

export const getAccountRules = () => {
  return {
    validator: (rule: any, value: string) => {
      value = value.trim()
      if (value.length < 5 || value.length > 20) {
        return Promise.reject('账号长度为5-20位')
      }
      const reg = /^[a-zA-Z0-9_]+$/
      if (!reg.test(value)) {
        return Promise.reject('账号只能包含字母、数字和下划线')
      }
      return Promise.resolve()
    },
    trigger: 'blur'
  }
}

export const getConfirmPasswordRules = (form: any, passwordField: string) => {
  return {
    validator: (rule: any, value: string) => {
      if (value !== form[passwordField]) {
        return Promise.reject('两次输入的密码不一致')
      }
      return Promise.resolve()
    },
    trigger: 'blur'
  }
}

export const getRequiredRules = (message: string, trigger: string | string[] = 'blur') => {
  return {
    required: true,
    message: message || '请输入内容',
    trigger
  }
}

export const generateInputRules = ({
  message = 'form.input_placeholder',
  trigger = ['blur', 'change'],
  validator = ['text']
} = {}) => {
  const rules = []
  if (validator.includes('text'))
    rules.push({
      validator: (rule, value, callback) => textValidator({ rule, value, callback, message }),
      trigger
    })
  return rules
}
