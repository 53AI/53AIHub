import type { IncomingMessage, ServerResponse } from 'http'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export interface MockRoute {
  method: HttpMethod
  path: string
  handler: (req: IncomingMessage, params: Record<string, string>, body: any) => any
}

interface RouteNode {
  param?: string
  children: Map<string, RouteNode>
  handlers: Map<HttpMethod, MockRoute['handler']>
}

const root: RouteNode = { children: new Map(), handlers: new Map() }

function segments(path: string): string[] {
  return path.split('/').filter(Boolean)
}

export function registerRoute(route: MockRoute) {
  let node = root
  for (const seg of segments(route.path)) {
    let key = seg
    let param: string | undefined
    if (seg.startsWith('{') && seg.endsWith('}')) {
      key = '*'
      param = seg.slice(1, -1)
    }
    if (!node.children.has(key)) {
      node.children.set(key, { param, children: new Map(), handlers: new Map() })
    }
    node = node.children.get(key)!
    if (param) node.param = param
  }
  node.handlers.set(route.method, route.handler)
}

export function registerRoutes(routes: MockRoute[]) {
  routes.forEach(registerRoute)
}

interface MatchResultObj {
  handler: MockRoute['handler']
  params: Record<string, string>
}

export function match(method: HttpMethod, path: string): MatchResultObj | null {
  const segs = segments(path)
  let node = root
  const params: Record<string, string> = {}

  for (const seg of segs) {
    if (node.children.has(seg)) {
      node = node.children.get(seg)!
    } else if (node.children.has('*')) {
      node = node.children.get('*')!
      if (node.param) params[node.param] = seg
    } else {
      return null
    }
  }

  const handler = node.handlers.get(method)
  if (!handler) return null
  return { handler, params }
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const method = (req.method?.toUpperCase() || 'GET') as HttpMethod

  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    res.statusCode = 204
    res.end()
    return true
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname

  const result = match(method, pathname)
  if (!result) return false

  let body: any = undefined
  if (method !== 'GET' && method !== 'DELETE') {
    body = await readBody(req)
  }

  try {
    const data = await result.handler(req, result.params, body)
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    res.statusCode = 200
    res.end(JSON.stringify(data))
  } catch (err: any) {
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 500
    res.end(JSON.stringify({ code: 4, message: err.message || 'Mock error', data: null }))
  }

  return true
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        resolve(data)
      }
    })
    req.on('error', () => resolve({}))
  })
}
