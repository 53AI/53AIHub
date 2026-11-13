import { describe, it, expect } from 'vitest'
import {
  isCompressibleImage,
  getFileExt,
  compressImageFile,
} from '@km/shared-components-react/CropperDialog/helpers'

describe('getFileExt', () => {
  it('常规扩展名直接返回（小写化）', () => {
    expect(getFileExt(new File([], 'photo.JPG', { type: 'image/jpeg' }))).toBe('jpg')
    expect(getFileExt(new File([], 'img.png', { type: 'image/png' }))).toBe('png')
  })

  it('无扩展名时用 MIME 兑底（移动端相册常见）', () => {
    expect(getFileExt(new File([], 'image', { type: 'image/jpeg' }))).toBe('jpeg')
    expect(getFileExt(new File([], 'image', { type: 'image/jpg' }))).toBe('jpg')
    expect(getFileExt(new File([], 'image', { type: 'image/png' }))).toBe('png')
  })

  it('无扩展名且无 MIME 时返回空串', () => {
    expect(getFileExt(new File([], 'image'))).toBe('')
  })

  it('有扩展名时优先用扩展名，不受 MIME 干扰', () => {
    // 扩展名是 heic 时即使 MIME 是 jpeg 也返回 heic，由调用方拒绝
    expect(getFileExt(new File([], 'IMG_0001.heic', { type: 'image/jpeg' }))).toBe('heic')
  })
})

describe('isCompressibleImage', () => {
  it('jpeg/png 可压缩', () => {
    expect(isCompressibleImage(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe(true)
    expect(isCompressibleImage(new File([], 'a.png', { type: 'image/png' }))).toBe(true)
  })

  it('ico/heic/空 MIME 不压缩', () => {
    expect(isCompressibleImage(new File([], 'a.ico', { type: 'image/x-icon' }))).toBe(false)
    expect(isCompressibleImage(new File([], 'a.heic', { type: 'image/heic' }))).toBe(false)
    expect(isCompressibleImage(new File([], 'a.jpg'))).toBe(false)
  })
})

describe('compressImageFile', () => {
  it('canvas 不可用时抛错（由调用方回退到大小校验报错）', async () => {
    const file = new File([new Uint8Array(10)], 'big.jpg', { type: 'image/jpeg' })
    await expect(compressImageFile(file, 1024)).rejects.toThrow()
  })
})
