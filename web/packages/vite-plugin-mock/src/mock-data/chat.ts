import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

export const chatRoutes: MockRoute[] = [
  {
    method: 'POST', path: '/v1/chat/completions',
    handler: (_req, _params, body) => {
      const isStream = body?.stream === true
      if (isStream) {
        return {
          id: 'chatcmpl-mock-' + Date.now(),
          object: 'chat.completion.chunk',
          created: now,
          model: body?.model || 'gpt-4o-mini',
          choices: [{
            index: 0,
            delta: { role: 'assistant', content: 'This is a mock response. The mock service is working correctly.' },
            finish_reason: null,
          }],
        }
      }
      return {
        id: 'chatcmpl-mock-' + Date.now(),
        object: 'chat.completion',
        created: now,
        model: body?.model || 'gpt-4o-mini',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'This is a mock response. The mock service is working correctly.' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }
    },
  },
  {
    method: 'POST', path: '/v1/workflow/run',
    handler: () => ok({
      workflow_run_id: 'wr-' + Date.now(),
      status: 'completed',
      outputs: { result: 'Mock workflow output' },
    }),
  },
  {
    method: 'POST', path: '/v1/rerank',
    handler: (_req, _params, body) => {
      const docs = body?.documents || []
      return ok({
        results: docs.map((doc: string, i: number) => ({
          index: i,
          relevance_score: 1 - i * 0.1,
          document: { text: doc },
        })),
      })
    },
  },
]
