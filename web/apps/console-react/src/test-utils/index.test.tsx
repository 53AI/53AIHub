/**
 * 测试框架验证测试
 * 验证 Vitest 和 Testing Library 配置正确
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderWithRouter } from '../test-utils'

describe('测试框架验证', () => {
  it('Vitest 基本断言应该正常工作', () => {
    expect(true).toBe(true)
    expect(1 + 1).toBe(2)
    expect('hello').toContain('ell')
  })

  it('React 组件渲染应该正常工作', () => {
    function TestComponent() {
      return <div data-testid="test-element">Hello World</div>
    }

    render(<TestComponent />)
    expect(screen.getByTestId('test-element')).toBeInTheDocument()
    expect(screen.getByText('Hello World')).toBeInTheDocument()
  })

  it('自定义 renderWithRouter 应该正常工作', () => {
    function TestComponent() {
      return <div data-testid="router-test">Router Works</div>
    }

    renderWithRouter(<TestComponent />)
    expect(screen.getByTestId('router-test')).toBeInTheDocument()
  })

  it('vi.fn mock 应该正常工作', () => {
    const mockFn = vi.fn()
    mockFn('test')
    expect(mockFn).toHaveBeenCalled()
    expect(mockFn).toHaveBeenCalledWith('test')
  })
})
