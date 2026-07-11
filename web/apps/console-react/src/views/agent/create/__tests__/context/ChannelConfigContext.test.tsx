/**
 * ChannelConfigContext 测试
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReactNode } from 'react'
import ChannelConfigContext, { useChannelConfig } from '../../context/ChannelConfigContext'
import type { ChannelConfig } from '../../types'

// 测试用消费者组件
function TestConsumer({ expectedValue }: { expectedValue?: ChannelConfig }) {
  const config = useChannelConfig()

  return (
    <div>
      <span data-testid="has-config">{config ? 'yes' : 'no'}</span>
      {expectedValue && (
        <>
          <span data-testid="channel-type">{config.channel_type}</span>
          <span data-testid="channel-id">{config.channel_id}</span>
          <span data-testid="channel-name">{config.name}</span>
        </>
      )}
    </div>
  )
}

// 创建带有 Provider 的包装组件
function renderWithProvider(
  ui: ReactNode,
  value: ChannelConfig = {}
) {
  return render(
    <ChannelConfigContext.Provider value={value}>
      {ui}
    </ChannelConfigContext.Provider>
  )
}

describe('ChannelConfigContext', () => {
  // ============ Provider 测试 ============
  describe('Provider', () => {
    it('应提供默认空对象', () => {
      render(
        <ChannelConfigContext.Provider value={{}}>
          <TestConsumer />
        </ChannelConfigContext.Provider>
      )

      expect(screen.getByTestId('has-config')).toHaveTextContent('yes')
    })

    it('应提供配置值给子组件', () => {
      const configValue: ChannelConfig = {
        channel_type: 1,
        channel_id: 100,
        name: '测试渠道',
      }

      renderWithProvider(<TestConsumer expectedValue={configValue} />, configValue)

      expect(screen.getByTestId('channel-type')).toHaveTextContent('1')
      expect(screen.getByTestId('channel-id')).toHaveTextContent('100')
      expect(screen.getByTestId('channel-name')).toHaveTextContent('测试渠道')
    })

    it('应能提供完整的 ChannelConfig', () => {
      const fullConfig: ChannelConfig = {
        channel_type: 2,
        channel_id: 200,
        name: '完整配置',
        label: '标签',
        value: 'value',
        key: 'key',
        base_url: 'https://api.example.com',
        models: ['gpt-4', 'gpt-3.5'],
        model: 'gpt-4',
        config: { custom: 'config' },
      }

      function FullConfigConsumer() {
        const config = useChannelConfig()
        return (
          <div>
            <span data-testid="base-url">{config.base_url}</span>
            <span data-testid="model">{config.model}</span>
            <span data-testid="models-count">{config.models?.length}</span>
          </div>
        )
      }

      renderWithProvider(<FullConfigConsumer />, fullConfig)

      expect(screen.getByTestId('base-url')).toHaveTextContent('https://api.example.com')
      expect(screen.getByTestId('model')).toHaveTextContent('gpt-4')
      expect(screen.getByTestId('models-count')).toHaveTextContent('2')
    })
  })

  // ============ useChannelConfig Hook 测试 ============
  describe('useChannelConfig', () => {
    it('应在 Provider 内正确获取值', () => {
      const configValue: ChannelConfig = {
        channel_type: 5,
        channel_id: 500,
      }

      function HookTest() {
        const config = useChannelConfig()
        return <span data-testid="channel-type">{config.channel_type}</span>
      }

      renderWithProvider(<HookTest />, configValue)

      expect(screen.getByTestId('channel-type')).toHaveTextContent('5')
    })

    it('应在没有 Provider 时返回默认值（空对象）', () => {
      // 注意：在实际情况中，可能需要 Provider 包裹
      // 这里测试 Context 的默认值行为
      function DefaultConsumer() {
        const config = useChannelConfig()
        return (
          <div>
            <span data-testid="is-empty">
              {Object.keys(config).length === 0 ? 'empty' : 'not-empty'}
            </span>
          </div>
        )
      }

      render(<DefaultConsumer />)

      // Context 默认值是空对象
      expect(screen.getByTestId('is-empty')).toHaveTextContent('empty')
    })

    it('应能获取嵌套的 config 对象', () => {
      const configValue: ChannelConfig = {
        config: {
          nested: {
            key: 'value',
          },
        },
      }

      function NestedConfigConsumer() {
        const config = useChannelConfig()
        return (
          <span data-testid="nested">
            {JSON.stringify(config.config)}
          </span>
        )
      }

      renderWithProvider(<NestedConfigConsumer />, configValue)

      expect(screen.getByTestId('nested')).toHaveTextContent('{"nested":{"key":"value"}}')
    })
  })

  // ============ 嵌套组件测试 ============
  describe('嵌套组件', () => {
    it('深层嵌套组件应能访问 Context', () => {
      const configValue: ChannelConfig = {
        channel_type: 99,
      }

      function DeepChild() {
        const config = useChannelConfig()
        return <span data-testid="deep-channel-type">{config.channel_type}</span>
      }

      function MiddleComponent() {
        return (
          <div>
            <DeepChild />
          </div>
        )
      }

      function ParentComponent() {
        return <MiddleComponent />
      }

      renderWithProvider(<ParentComponent />, configValue)

      expect(screen.getByTestId('deep-channel-type')).toHaveTextContent('99')
    })

    it('多个组件应共享同一 Context 值', () => {
      const configValue: ChannelConfig = {
        channel_type: 10,
        channel_id: 20,
      }

      function ComponentA() {
        const config = useChannelConfig()
        return <span data-testid="comp-a">{config.channel_type}</span>
      }

      function ComponentB() {
        const config = useChannelConfig()
        return <span data-testid="comp-b">{config.channel_id}</span>
      }

      render(
        <ChannelConfigContext.Provider value={configValue}>
          <ComponentA />
          <ComponentB />
        </ChannelConfigContext.Provider>
      )

      expect(screen.getByTestId('comp-a')).toHaveTextContent('10')
      expect(screen.getByTestId('comp-b')).toHaveTextContent('20')
    })
  })

  // ============ 更新场景测试 ============
  describe('值更新', () => {
    it('Provider 值更新时子组件应重新渲染', () => {
      const { rerender } = render(
        <ChannelConfigContext.Provider value={{ channel_type: 1 }}>
          <TestConsumer expectedValue={{ channel_type: 1 }} />
        </ChannelConfigContext.Provider>
      )

      expect(screen.getByTestId('channel-type')).toHaveTextContent('1')

      // 更新值
      rerender(
        <ChannelConfigContext.Provider value={{ channel_type: 2 }}>
          <TestConsumer expectedValue={{ channel_type: 2 }} />
        </ChannelConfigContext.Provider>
      )

      expect(screen.getByTestId('channel-type')).toHaveTextContent('2')
    })
  })
})
