export const textValidator = ({ rule, value, callback, message } = {}) => {
	value = String(value) || ''.trim()
	if (!value) return callback(new Error(window.$t(message)))
	callback()
}

export const linkValidator = ({ rule, value, callback, message } = {}) => {
	value = (value || '').trim()
	if (!value) return callback(new Error(window.$t(message)))
	if (!/^(https?:\/\/)?((([\w.-]+)(\.[\w.-]+)+)|((\d{1,3}\.){3}\d{1,3}))(:\d+)?([\/#\?].*)?$/.test(value)) return callback(new Error(window.$t('form_link_validator')))
	callback()
}

export const mobileValidator = ({ rule, value, callback, message } = {}) => {
	value = (value || '').trim()
	if (!value) return callback(new Error(window.$t(message)))
	if (!/^(\+86)?(13[0-9]|14[0-9]|15[0-9]|16[0-9]|17[0-9]|18[0-9]|19[0-9])\d{8}$/.test(value)) return callback(new Error(window.$t('form_mobile_validator')))
	callback()
}

export const emailValidator = ({ rule, value, callback, message } = {}) => {
	value = (value || '').trim()
	if (!value) return callback(new Error(window.$t(message)))
	if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)) return callback(new Error(window.$t('form_email_validator')))
	callback()
}

export const mobileOrEmailValidator = ({ rule, value, callback, message } = {}) => {
	value = (value || '').trim()
	if (!value) return callback(new Error(window.$t(message)))
	if (!/^(13[0-9]|14[0-9]|15[0-9]|16[0-9]|17[0-9]|18[0-9]|19[0-9])\d{8}$/.test(value) && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)) return callback(new Error(window.$t('form_mobile_or_email_validator')))
	callback()
}

export const passwordValidator = ({ rule, value, callback, message } = {}) => {
	value = String(value) || ''.trim()
	if (/[\u4e00-\u9fa5]/.test(value) || /[\s]/.test(value)) return callback(new Error(window.$t('form_password_validator')))
	if (!value) return callback(new Error(window.$t(message)))
	callback()
}

export const urlValidator = ({ rule, value, callback, message } = {}) => {
	value = (value || '').trim()
	if (!value) return callback(new Error(window.$t(message)))
	if (!/^(https?:\/\/)?([\w.-]+)(\.[\w.-]+)+([\/#\?].*)?$/.test(value)) return callback(new Error(window.$t('form_url_validator')))
	callback()
}
export const pathValidator = ({ rule, value, callback, message } = {}) => {
	value = (value || '').trim()
	if (!value) return callback(new Error(window.$t(message)))
	if (!/^(\/[\w-]+)+$/.test(value)) return callback(new Error(window.$t('form_path_validator')))
	callback()
}

export const generateInputRules = ({ message = 'form_input_placeholder', trigger = 'blur', validator = ['text'] } = {}) => {
	const rules = []
	if (validator.includes('text')) rules.push({
		validator: (rule, value, callback) => textValidator({ rule, value, callback, message }),
		trigger
	})
	if (validator.includes('link')) rules.push({
		validator: (rule, value, callback) => linkValidator({ rule, value, callback, message }),
		trigger
	})
	if (validator.includes('mobile') && validator.includes('email')) rules.push({
		validator: (rule, value, callback) => mobileOrEmailValidator({ rule, value, callback, message }),
		trigger
	})
	else if (validator.includes('mobile')) rules.push({
		validator: (rule, value, callback) => mobileValidator({ rule, value, callback, message }),
		trigger
	})
	else if (validator.includes('email')) rules.push({
		validator: (rule, value, callback) => emailValidator({ rule, value, callback, message }),
		trigger
	})
	if (validator.includes('password')) rules.push({
		validator: (rule, value, callback) => passwordValidator({ rule, value, callback, message }),
		trigger
	})
	if (validator.includes('url')) rules.push({
		validator: (rule, value, callback) => urlValidator({ rule, value, callback, message }),
		trigger
	})
	if (validator.includes('path')) rules.push({
		validator: (rule, value, callback) => pathValidator({ rule, value, callback, message }),
		trigger
	})
	return rules
}
