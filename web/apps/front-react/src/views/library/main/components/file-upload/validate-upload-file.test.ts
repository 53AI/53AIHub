/**
 * 单文件校验 + 校验失败提示文案的测试
 *
 * 背景：校验结果用结构化 code 区分三种处理——临时文件静默过滤、超限文件入队置为失败、
 * 类型不符提示用户；buildInvalidFilesMessage 只负责把需要提示的项拼成一句话。
 */
import { describe, expect, it } from 'vitest'

import type { FileValidationResult } from './util'
import {
  buildInvalidFilesMessage,
  isTempFile,
  resolveMaxSizeBytes,
  validateUploadFile
} from './util'

const MB = 1024 * 1024
const FILE_MAX = 500 * MB

/** jsdom 不许真的造 500MB 数据，直接改写 size */
const makeFile = (name: string, sizeBytes: number, type = ''): File => {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: sizeBytes })
  return file
}

const expectInvalid = (result: FileValidationResult) => {
  expect(result.valid).toBe(false)
  return result as Extract<FileValidationResult, { valid: false }>
}

const baseOptions = { allowedTypes: ['.pdf', '.md'], maxSizeBytes: FILE_MAX }

describe('validateUploadFile', () => {
  it('超过单文件上限时返回 size 原因与统一上限文案', () => {
    const result = expectInvalid(validateUploadFile(makeFile('big.pdf', 501 * MB), baseOptions))

    expect(result.code).toBe('size')
    expect(result.message).toBe('文件大小超过上限')
  })

  it('恰好等于上限时通过（边界为 <=）', () => {
    expect(validateUploadFile(makeFile('edge.pdf', FILE_MAX), baseOptions).valid).toBe(true)
  })

  it('按扩展名覆盖上限时，只影响该扩展名', () => {
    const options = { ...baseOptions, maxSizeBytesByExtension: { pdf: 10 * MB } }

    const rejected = expectInvalid(validateUploadFile(makeFile('big.pdf', 20 * MB), options))
    expect(rejected.code).toBe('size')

    // md 没被覆盖，仍用默认上限
    expect(validateUploadFile(makeFile('big.md', 20 * MB), options).valid).toBe(true)
  })

  it('扩展名大小写不敏感', () => {
    const options = { ...baseOptions, maxSizeBytesByExtension: { pdf: 10 * MB } }

    // BIG.PDF 命中 pdf 覆盖值（10MB）；若按大小写区分会落到 500MB 默认上限而通过
    const result = expectInvalid(validateUploadFile(makeFile('BIG.PDF', 20 * MB), options))
    expect(result.code).toBe('size')
  })

  it('类型不符时返回 type 原因', () => {
    const result = expectInvalid(validateUploadFile(makeFile('a.zip', 1 * MB), baseOptions))

    expect(result.code).toBe('type')
    expect(result.message).toBe('不支持的文件类型，仅支持：pdf、md')
  })

  it('临时文件返回 temp 原因（由调用方静默过滤，不提示用户）', () => {
    const result = expectInvalid(validateUploadFile(makeFile('.DS_Store', 1 * MB), baseOptions))

    expect(result.code).toBe('temp')
  })

  it('类型与大小都不合格时优先报类型', () => {
    const result = expectInvalid(validateUploadFile(makeFile('a.zip', 501 * MB), baseOptions))
    expect(result.code).toBe('type')
  })
})

describe('resolveMaxSizeBytes', () => {
  it('没有按扩展名覆盖时用默认上限', () => {
    expect(resolveMaxSizeBytes('a.pdf', baseOptions)).toBe(FILE_MAX)
  })

  it('扩展名命中覆盖时用覆盖值，且大小写不敏感', () => {
    const options = { ...baseOptions, maxSizeBytesByExtension: { pdf: 10 * MB } }

    expect(resolveMaxSizeBytes('a.pdf', options)).toBe(10 * MB)
    expect(resolveMaxSizeBytes('A.PDF', options)).toBe(10 * MB)
    // 其他扩展名仍用默认上限
    expect(resolveMaxSizeBytes('a.md', options)).toBe(FILE_MAX)
  })
})

describe('isTempFile', () => {
  it.each(['.DS_Store', 'thumbs.db', 'desktop.ini', 'draft.tmp', 'a.bak', '.env'])(
    '%s 判定为临时/系统文件',
    (name) => {
      expect(isTempFile(makeFile(name, 1))).toBe(true)
    }
  )

  it.each(['notes.md', 'report.txt', 'page.html', 'data.csv'])('%s 是正常文件', (name) => {
    expect(isTempFile(makeFile(name, 1))).toBe(false)
  })
})

describe('buildInvalidFilesMessage', () => {
  const sizeIssue = { name: 'big.pdf', message: '文件大小超过上限' }

  it('没有不合格文件时不需要提示', () => {
    expect(buildInvalidFilesMessage([], 3)).toBeNull()
  })

  it('单个不合格文件直接展示文件名与原因', () => {
    expect(buildInvalidFilesMessage([sizeIssue], 0)).toBe('big.pdf：文件大小超过上限')
  })

  it('混选场景同样要提示，并说明其余文件继续上传', () => {
    const message = buildInvalidFilesMessage(
      [sizeIssue, { name: 'a.zip', message: '不支持的文件类型，仅支持：pdf、md' }],
      3
    )

    expect(message).toBe(
      '2 个文件未通过校验，已跳过：big.pdf、a.zip，其余 3 个文件继续上传'
    )
  })

  it('全部不合格时不提「其余继续上传」', () => {
    const message = buildInvalidFilesMessage([sizeIssue, { name: 'a.zip', message: 'x' }], 0)

    expect(message).toContain('2 个文件未通过校验')
    expect(message).not.toContain('继续上传')
  })

  it('数量很多时只列前 5 个文件名，避免提示过长', () => {
    const invalid = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}.pdf`, message: 'x' }))

    const message = buildInvalidFilesMessage(invalid, 0)

    expect(message).toContain('8 个文件未通过校验')
    expect(message).toContain('f0.pdf、f1.pdf、f2.pdf、f3.pdf、f4.pdf 等 8 个')
    expect(message).not.toContain('f5.pdf')
  })
})
