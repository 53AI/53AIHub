/**
 * 短ID编码工具：压缩 + Base64URL（URL 安全、可逆、更短）
 */

async function compressBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    try {
      const stream = new CompressionStream('deflate')
      const writer = stream.writable.getWriter()
      const reader = stream.readable.getReader()

      const buffer = new ArrayBuffer(bytes.length)
      const bytesCopy = new Uint8Array(buffer)
      bytesCopy.set(bytes)
      writer.write(bytesCopy)
      writer.close()

      const chunks: Uint8Array[] = []
      let done = false

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        done = readerDone
        if (value) {
          chunks.push(new Uint8Array(value))
        }
      }

      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const result = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
      }

      return result
    } catch {
      return bytes
    }
  }
  return bytes
}

async function decompressBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const stream = new DecompressionStream('deflate')
      const writer = stream.writable.getWriter()
      const reader = stream.readable.getReader()

      const buffer = new ArrayBuffer(bytes.length)
      const bytesCopy = new Uint8Array(buffer)
      bytesCopy.set(bytes)
      writer.write(bytesCopy)
      writer.close()

      const chunks: Uint8Array[] = []
      let done = false

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        done = readerDone
        if (value) {
          chunks.push(new Uint8Array(value))
        }
      }

      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const result = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
      }

      return result
    } catch {
      return bytes
    }
  }
  return bytes
}

export async function encodeShortId(str: string): Promise<string> {
  try {
    const utf8Bytes = new TextEncoder().encode(str)
    const compressedBytes = await compressBytes(utf8Bytes)

    let binaryString = ''
    for (let i = 0; i < compressedBytes.length; i++) {
      binaryString += String.fromCharCode(compressedBytes[i])
    }

    const base64 = btoa(binaryString)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    return base64
  } catch (error) {
    console.error('编码失败:', error)
    throw new Error('短ID编码失败')
  }
}

export function encodeShortIdSync(str: string): string {
  try {
    const utf8Bytes = new TextEncoder().encode(str)

    let binaryString = ''
    for (let i = 0; i < utf8Bytes.length; i++) {
      binaryString += String.fromCharCode(utf8Bytes[i])
    }

    const base64 = btoa(binaryString)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    return base64
  } catch (error) {
    console.error('编码失败:', error)
    throw new Error('短ID编码失败')
  }
}

export async function decodeShortId(shortId: string): Promise<string> {
  try {
    let base64 = shortId.replace(/-/g, '+').replace(/_/g, '/')

    while (base64.length % 4 !== 0) {
      base64 += '='
    }

    const binaryString = atob(base64)

    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    let decompressedBytes: Uint8Array
    try {
      decompressedBytes = await decompressBytes(bytes)
    } catch {
      decompressedBytes = bytes
    }

    return new TextDecoder().decode(decompressedBytes)
  } catch (error) {
    console.error('解码失败:', error)
    throw new Error('短ID解码失败')
  }
}

export function decodeShortIdSync(shortId: string): string {
  try {
    let base64 = shortId.replace(/-/g, '+').replace(/_/g, '/')

    while (base64.length % 4 !== 0) {
      base64 += '='
    }

    const binaryString = atob(base64)

    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    return new TextDecoder().decode(bytes)
  } catch (error) {
    console.error('解码失败:', error)
    throw new Error('短ID解码失败')
  }
}

export async function isValidShortId(shortId: string): Promise<boolean> {
  if (!shortId || typeof shortId !== 'string') {
    return false
  }
  const base64UrlRegex = /^[A-Za-z0-9_-]+$/
  if (!base64UrlRegex.test(shortId)) {
    return false
  }
  try {
    await decodeShortId(shortId)
    return true
  } catch {
    return false
  }
}

export function isValidShortIdSync(shortId: string): boolean {
  if (!shortId || typeof shortId !== 'string') {
    return false
  }
  const base64UrlRegex = /^[A-Za-z0-9_-]+$/
  if (!base64UrlRegex.test(shortId)) {
    return false
  }
  try {
    decodeShortIdSync(shortId)
    return true
  } catch {
    return false
  }
}

export function getEncodedLength(str: string, compressed = true): number {
  const utf8Length = new TextEncoder().encode(str).length

  if (compressed) {
    const compressedLength = Math.ceil(utf8Length * 0.4)
    return Math.ceil((compressedLength * 4) / 3)
  }
  return Math.ceil((utf8Length * 4) / 3)
}

export function supportsCompression(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}
