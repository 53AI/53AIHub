/**
 * 空格键拦截的回归测试（处理器来自 @km/shared-utils）
 *
 * 键入路径由 onKeyDown 拦截；粘贴 / 自动填充等非键击路径由表单校验规则兜底。
 */
import { describe, expect, it } from 'vitest'

import { noSpaceKeydownHandler } from '@km/shared-utils'

const keydown = (key: string) => {
  let prevented = false
  noSpaceKeydownHandler({
    key,
    preventDefault: () => {
      prevented = true
    },
  })
  return prevented
}

describe('noSpaceKeydownHandler', () => {
  it('空格键被拦截', () => {
    expect(keydown(' ')).toBe(true)
  })

  it('其它按键不受影响', () => {
    expect(keydown('a')).toBe(false)
    expect(keydown('Enter')).toBe(false)
    expect(keydown('Backspace')).toBe(false)
  })
})
