/**
 * MSW Server 配置
 * 用于 Node.js 环境的测试
 *
 * @example
 * // vitest.setup.ts
 * import { server } from './mocks/server'
 *
 * beforeAll(() => server.listen())
 * afterEach(() => server.resetHandlers())
 * afterAll(() => server.close())
 */
import { setupServer } from 'msw/node'
import { toolboxHandlers } from './handlers'

/**
 * 创建 MSW Server
 */
export const server = setupServer(...toolboxHandlers)

/**
 * 启动 server（在 beforeAll 中调用）
 */
export function startServer(): void {
  server.listen({
    onUnhandledRequest: 'warn', // 未处理的请求输出警告
  })
}

/**
 * 重置 handlers（在 afterEach 中调用）
 */
export function resetServer(): void {
  server.resetHandlers()
}

/**
 * 关闭 server（在 afterAll 中调用）
 */
export function stopServer(): void {
  server.close()
}

/**
 * 自定义 handler（用于特定测试场景）
 *
 * @example
 * import { server } from './mocks/server'
 * import { http, HttpResponse } from 'msw'
 *
 * it('处理错误响应', async () => {
 *   server.use(
 *     http.get('/api/ai-link/list', () => HttpResponse.json({ error: 'test' }, { status: 500 }))
 *   )
 *   // ...测试代码
 * })
 */
export { server }

export default server
