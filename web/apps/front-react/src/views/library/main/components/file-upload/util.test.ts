/**
 * calculateFileHash 的回归测试
 *
 * 关注两个分支：
 * 1. crypto.subtle 可用 → 走 Web Crypto API
 * 2. crypto.subtle 不可用（HTTP 非安全上下文 / 旧浏览器） → 降级到 js-sha256
 *
 * SHA-256 参考值取 NIST 公开样例：
 * "hello world" → b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { calculateFileHash } from './util'

const HELLO_WORLD_SHA256 =
  'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'

function buildFile(content: string, name = 'test.txt'): File {
  const file = new File([content], name, { type: 'text/plain' })
  // jsdom 的 File 没有 arrayBuffer 方法，手动补一个
  if (typeof file.arrayBuffer !== 'function') {
    ;(file as any).arrayBuffer = async () =>
      new TextEncoder().encode(content).buffer
  }
  return file
}

function buildBinaryFile(bytes: Uint8Array, name = 'binary.bin'): File {
  const file = new File([bytes], name)
  if (typeof file.arrayBuffer !== 'function') {
    ;(file as any).arrayBuffer = async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }
  return file
}

describe('calculateFileHash', () => {
  const originalSubtle = globalThis.crypto?.subtle

  afterEach(() => {
    // 还原 crypto.subtle，避免污染其他测试
    if (originalSubtle !== undefined) {
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: originalSubtle,
        configurable: true,
        writable: true
      })
    }
  })

  it('通过 Web Crypto API 计算文件 SHA-256', async () => {
    const file = buildFile('hello world')
    const hash = await calculateFileHash(file)
    expect(hash).toBe(HELLO_WORLD_SHA256)
  })

  describe('crypto.subtle 不可用时降级', () => {
    beforeEach(() => {
      // 模拟非安全上下文：删掉 crypto.subtle
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: undefined,
        configurable: true,
        writable: true
      })
    })

    it('回退到 js-sha256 仍返回正确的 SHA-256', async () => {
      const file = buildFile('hello world')
      const hash = await calculateFileHash(file)
      expect(hash).toBe(HELLO_WORLD_SHA256)
    })

    it('空文件也返回正确 hash（空串 SHA-256）', async () => {
      // 空串 SHA-256 = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      const file = buildFile('')
      const hash = await calculateFileHash(file)
      expect(hash).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      )
    })

    it('二进制内容（任意字节）也能算 hash', async () => {
      const bytes = new Uint8Array([0, 1, 2, 255, 128, 64])
      const file = buildBinaryFile(bytes)
      const hash = await calculateFileHash(file)
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
      // SHA-256 of [0,1,2,255,128,64] = f3ffbf48eb68de8dc8beee220db50fef55f77f4feae0e74a4d556b4f2b7ec029
      expect(hash).toBe(
        'f3ffbf48eb68de8dc8beee220db50fef55f77f4feae0e74a4d556b4f2b7ec029'
      )
    })
  })
})
