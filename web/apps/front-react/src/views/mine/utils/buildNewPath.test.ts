import { describe, it, expect } from 'vitest'
import { buildNewPath } from './buildNewPath'

describe('buildNewPath', () => {
  it('文件夹直接拼接', () => {
    expect(buildNewPath({ name: '工作', isfolder: true }, '/目标')).toBe('/目标/工作')
  })

  it('文件保留 file_ext 后缀', () => {
    expect(
      buildNewPath({ name: '笔记', isfolder: false, file_ext: 'md' }, '/目标')
    ).toBe('/目标/笔记.md')
  })

  it('file_ext 含点号时不去重', () => {
    expect(
      buildNewPath({ name: '音频', isfolder: false, file_ext: '.m4a' }, '/目标')
    ).toBe('/目标/音频.m4a')
  })

  it('目标根目录拼接', () => {
    expect(buildNewPath({ name: '工作', isfolder: true }, '/')).toBe('/工作')
  })

  it('无 file_ext 时不补后缀', () => {
    expect(buildNewPath({ name: '笔记', isfolder: false }, '/目标')).toBe('/目标/笔记')
  })
})
