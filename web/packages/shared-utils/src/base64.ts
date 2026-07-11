/**
 * Base64 编码解码工具函数
 */

/**
 * Base64 字符表
 */
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='

/**
 * 将字符串编码为 Base64
 */
export const base64Encode = (str: string): string => {
  if (typeof window !== 'undefined' && window.btoa) {
    try {
      return window.btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_match, p1) => {
        return String.fromCharCode(Number.parseInt(p1, 16))
      }))
    } catch {
      // 如果包含非 ASCII 字符，使用手动实现
    }
  }
  return base64EncodeManual(str)
}

const base64EncodeManual = (str: string): string => {
  let output = ''
  let i = 0
  const utf8Str = utf8Encode(str)

  while (i < utf8Str.length) {
    const chr1 = utf8Str.charCodeAt(i++)
    const chr2 = utf8Str.charCodeAt(i++)
    const chr3 = utf8Str.charCodeAt(i++)

    const enc1 = chr1 >> 2
    const enc2 = ((chr1 & 3) << 4) | (chr2 >> 4)
    let enc3 = ((chr2 & 15) << 2) | (chr3 >> 6)
    let enc4 = chr3 & 63

    if (Number.isNaN(chr2)) {
      enc3 = 64
      enc4 = 64
    } else if (Number.isNaN(chr3)) {
      enc4 = 64
    }

    output += BASE64_CHARS.charAt(enc1)
    output += BASE64_CHARS.charAt(enc2)
    output += BASE64_CHARS.charAt(enc3)
    output += BASE64_CHARS.charAt(enc4)
  }

  return output
}

/**
 * 将 Base64 字符串解码为原始字符串
 */
export const base64Decode = (base64: string): string => {
  if (typeof window !== 'undefined' && window.atob) {
    try {
      const decoded = window.atob(base64)
      return decodeURIComponent(
        decoded
          .split('')
          .map((char) => {
            return '%' + ('00' + char.charCodeAt(0).toString(16)).slice(-2)
          })
          .join('')
      )
    } catch {
      // 如果解码失败，使用手动实现
    }
  }
  return base64DecodeManual(base64)
}

const base64DecodeManual = (base64: string): string => {
  let output = ''
  let i = 0

  base64 = base64.replace(/[^A-Za-z0-9+/=]/g, '')

  while (i < base64.length) {
    const enc1 = BASE64_CHARS.indexOf(base64.charAt(i++))
    const enc2 = BASE64_CHARS.indexOf(base64.charAt(i++))
    const enc3 = BASE64_CHARS.indexOf(base64.charAt(i++))
    const enc4 = BASE64_CHARS.indexOf(base64.charAt(i++))

    const chr1 = (enc1 << 2) | (enc2 >> 4)
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2)
    const chr3 = ((enc3 & 3) << 6) | enc4

    output += String.fromCharCode(chr1)

    if (enc3 !== 64) {
      output += String.fromCharCode(chr2)
    }
    if (enc4 !== 64) {
      output += String.fromCharCode(chr3)
    }
  }

  return utf8Decode(output)
}

export const base64URLEncode = (str: string): string => {
  return base64Encode(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export const base64URLDecode = (base64url: string): string => {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4 !== 0) {
    base64 += '='
  }
  return base64Decode(base64)
}

export const base64EncodeBytes = (bytes: Uint8Array): string => {
  if (typeof window !== 'undefined' && window.btoa) {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return window.btoa(binary)
  }

  let output = ''
  let i = 0

  while (i < bytes.length) {
    const byte1 = bytes[i++]
    const byte2 = bytes[i++]
    const byte3 = bytes[i++]

    const enc1 = byte1 >> 2
    const enc2 = ((byte1 & 3) << 4) | (byte2 >> 4)
    let enc3 = ((byte2 & 15) << 2) | (byte3 >> 6)
    let enc4 = byte3 & 63

    if (i - 1 >= bytes.length) {
      enc3 = 64
      enc4 = 64
    } else if (i >= bytes.length) {
      enc4 = 64
    }

    output += BASE64_CHARS.charAt(enc1)
    output += BASE64_CHARS.charAt(enc2)
    output += BASE64_CHARS.charAt(enc3)
    output += BASE64_CHARS.charAt(enc4)
  }

  return output
}

export const base64DecodeBytes = (base64: string): Uint8Array => {
  if (typeof window !== 'undefined' && window.atob) {
    const binaryString = window.atob(base64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes
  }

  base64 = base64.replace(/[^A-Za-z0-9+/=]/g, '')
  const output: number[] = []
  let i = 0

  while (i < base64.length) {
    const enc1 = BASE64_CHARS.indexOf(base64.charAt(i++))
    const enc2 = BASE64_CHARS.indexOf(base64.charAt(i++))
    const enc3 = BASE64_CHARS.indexOf(base64.charAt(i++))
    const enc4 = BASE64_CHARS.indexOf(base64.charAt(i++))

    const byte1 = (enc1 << 2) | (enc2 >> 4)
    const byte2 = ((enc2 & 15) << 4) | (enc3 >> 2)
    const byte3 = ((enc3 & 3) << 6) | enc4

    output.push(byte1)

    if (enc3 !== 64) {
      output.push(byte2)
    }
    if (enc4 !== 64) {
      output.push(byte3)
    }
  }

  return new Uint8Array(output)
}

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export const base64ToBlob = (base64: string, mimeType = 'application/octet-stream'): Blob => {
  if (base64.includes(',')) {
    const [header, data] = base64.split(',')
    const mimeMatch = header.match(/:(.*?);/)
    if (mimeMatch) {
      mimeType = mimeMatch[1]
    }
    base64 = data
  }

  const bytes = base64DecodeBytes(base64)
  return new Blob([bytes.buffer.slice(0, bytes.length)], { type: mimeType })
}

export const fileToBase64 = (file: File): Promise<string> => {
  return blobToBase64(file)
}

export const base64ToFile = (
  base64: string,
  filename: string,
  mimeType = 'application/octet-stream'
): File => {
  const blob = base64ToBlob(base64, mimeType)
  return new File([blob], filename, { type: mimeType })
}

const utf8Encode = (str: string): string => {
  str = str.replace(/\r\n/g, '\n')
  let utftext = ''

  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i)

    if (charCode < 128) {
      utftext += String.fromCharCode(charCode)
    } else if (charCode > 127 && charCode < 2048) {
      utftext += String.fromCharCode((charCode >> 6) | 192)
      utftext += String.fromCharCode((charCode & 63) | 128)
    } else {
      utftext += String.fromCharCode((charCode >> 12) | 224)
      utftext += String.fromCharCode(((charCode >> 6) & 63) | 128)
      utftext += String.fromCharCode((charCode & 63) | 128)
    }
  }

  return utftext
}

const utf8Decode = (utftext: string): string => {
  let str = ''
  let i = 0

  while (i < utftext.length) {
    const charCode = utftext.charCodeAt(i)

    if (charCode < 128) {
      str += String.fromCharCode(charCode)
      i++
    } else if (charCode > 191 && charCode < 224) {
      const charCode2 = utftext.charCodeAt(i + 1)
      str += String.fromCharCode(((charCode & 31) << 6) | (charCode2 & 63))
      i += 2
    } else {
      const charCode2 = utftext.charCodeAt(i + 1)
      const charCode3 = utftext.charCodeAt(i + 2)
      str += String.fromCharCode(((charCode & 15) << 12) | ((charCode2 & 63) << 6) | (charCode3 & 63))
      i += 3
    }
  }

  return str
}

export const isValidBase64 = (str: string): boolean => {
  if (!str || str.length === 0) {
    return false
  }
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/
  if (!base64Regex.test(str)) {
    return false
  }
  return str.length % 4 === 0
}

export const isValidBase64URL = (str: string): boolean => {
  if (!str || str.length === 0) {
    return false
  }
  const base64URLRegex = /^[A-Za-z0-9_-]+$/
  return base64URLRegex.test(str)
}
