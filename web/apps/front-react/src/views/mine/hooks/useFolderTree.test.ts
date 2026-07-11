import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFolderTree } from './useFolderTree'

const fakeFetchDirs = vi.fn()

const makeFetch = (dataByPath: Record<string, any[]>) => {
  return vi.fn(async ({ path }: { path?: string; keyword?: string; type?: string }) => {
    const key = path || '/'
    return { data: dataByPath[key] || [] }
  })
}

describe('useFolderTree', () => {
  beforeEach(() => {
    fakeFetchDirs.mockReset()
  })

  it('初始状态：rootDirNodes 与 rootFileNodes 都为空', () => {
    const fetch = makeFetch({ '/': [] })
    const { result } = renderHook(() => useFolderTree(fetch))
    expect(result.current.rootDirNodes).toEqual([])
    expect(result.current.rootFileNodes).toEqual([])
  })

  it('loadDirChildren("/") 后填充 rootDirNodes', async () => {
    const fetch = makeFetch({ '/': [{ id: '1', path: '/A', name: 'A' }] })
    const { result } = renderHook(() => useFolderTree(fetch))

    await act(async () => {
      await result.current.loadDirChildren('/')
    })

    expect(result.current.rootDirNodes).toHaveLength(1)
    expect(result.current.rootDirNodes[0].path).toBe('/A')
    expect(result.current.isDirLoading('/')).toBe(false)
  })

  it('loadFileChildren("/") 后填充 rootFileNodes', async () => {
    const fetch = makeFetch({ '/': [{ id: '2', path: '/note.md', name: 'note.md' }] })
    const { result } = renderHook(() => useFolderTree(fetch))

    await act(async () => {
      await result.current.loadFileChildren('/')
    })

    expect(result.current.rootFileNodes).toHaveLength(1)
    expect(result.current.rootFileNodes[0].path).toBe('/note.md')
    expect(result.current.isFileLoading('/')).toBe(false)
  })

  it('二次展开同一路径命中缓存不重复请求', async () => {
    const fetch = makeFetch({ '/A': [{ id: '2', path: '/A/B', name: 'B' }] })
    const { result } = renderHook(() => useFolderTree(fetch))

    await act(async () => {
      await result.current.loadDirChildren('/A')
    })
    await act(async () => {
      await result.current.loadDirChildren('/A')
    })

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reloadDir 重置后重新请求', async () => {
    const fetch = makeFetch({ '/': [{ id: '1', path: '/A', name: 'A' }] })
    const { result } = renderHook(() => useFolderTree(fetch))

    await act(async () => {
      await result.current.loadDirChildren('/')
    })
    await act(async () => {
      await result.current.reloadDir('/')
    })

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('getPathById 在 loadDirChildren 后能反查路径', async () => {
    const fetch = makeFetch({
      '/': [
        { id: '1', path: '/A', name: 'A' },
        { id: '2', path: '/B', name: 'B' },
      ],
    })
    const { result } = renderHook(() => useFolderTree(fetch))

    await act(async () => {
      await result.current.loadDirChildren('/')
    })

    expect(result.current.getPathById('1')).toBe('/A')
    expect(result.current.getPathById('2')).toBe('/B')
    expect(result.current.getPathById('nope')).toBeUndefined()
  })

  it('reset 后 getPathById 返回 undefined', async () => {
    const fetch = makeFetch({ '/': [{ id: '1', path: '/A', name: 'A' }] })
    const { result } = renderHook(() => useFolderTree(fetch))

    await act(async () => {
      await result.current.loadDirChildren('/')
    })
    expect(result.current.getPathById('1')).toBe('/A')

    act(() => {
      result.current.reset()
    })
    expect(result.current.getPathById('1')).toBeUndefined()
  })

  it('fetch 失败后 dirError 标记为 true', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('boom')
    })
    const { result } = renderHook(() => useFolderTree(fetch))

    await act(async () => {
      await result.current.loadDirChildren('/')
    })

    expect(result.current.dirError('/')).toBe(true)
  })

  it('dir 与 file 缓存相互独立（同名 path 不互相覆盖）', async () => {
    const fetch = vi.fn(async ({ path, type }: { path?: string; type?: 'dir' | 'file' }) => {
      if (type === 'file') return { data: [{ id: 'f1', path: '/note.md', name: 'note.md' }] }
      return { data: [{ id: 'd1', path: '/A', name: 'A' }] }
    })
    const { result } = renderHook(() => useFolderTree(fetch))

    await act(async () => {
      await Promise.all([
        result.current.loadDirChildren('/'),
        result.current.loadFileChildren('/'),
      ])
    })

    expect(result.current.rootDirNodes).toHaveLength(1)
    expect(result.current.rootFileNodes).toHaveLength(1)
    expect(result.current.getPathById('d1')).toBe('/A')
    expect(result.current.getPathById('f1')).toBe('/note.md')
  })

  it('version 在每次缓存变更后递增', async () => {
    const fetch = makeFetch({ '/': [{ id: '1', path: '/A', name: 'A' }] })
    const { result } = renderHook(() => useFolderTree(fetch))
    const v0 = result.current.version
    expect(v0).toBe(0)

    await act(async () => {
      await result.current.loadDirChildren('/')
    })
    // load 结束至少触发两次 trigger（loading=true 与 loading=false）
    expect(result.current.version).toBeGreaterThan(v0)
  })

  it('getDirChildren/getFileChildren 能读到非根 path 的懒加载子树（修 MoveToModal 关键 API）', async () => {
    const fetch = vi.fn(async ({ path, type }: { path?: string; type?: 'dir' | 'file' }) => {
      // 故意让 dir 与 file 返回不同数据
      if (type === 'file') {
        if (path === '/A') return { data: [{ id: 'f1', path: '/A/note.md', name: 'note.md' }] }
        return { data: [] }
      }
      if (path === '/') return { data: [{ id: 'd1', path: '/A', name: 'A' }] }
      if (path === '/A') return { data: [{ id: 'd2', path: '/A/B', name: 'B' }] }
      return { data: [] }
    })
    const { result } = renderHook(() => useFolderTree(fetch))

    await act(async () => {
      await result.current.loadDirChildren('/')
    })
    expect(result.current.rootDirNodes).toHaveLength(1)

    // 还没懒加载 /A 之前，对应子节点是空数组，且不污染 cache
    expect(result.current.getDirChildren('/A')).toEqual([])
    expect(result.current.getFileChildren('/A')).toEqual([])

    await act(async () => {
      await result.current.loadDirChildren('/A')
      await result.current.loadFileChildren('/A')
    })
    expect(result.current.getDirChildren('/A')).toHaveLength(1)
    expect(result.current.getDirChildren('/A')[0].path).toBe('/A/B')
    expect(result.current.getFileChildren('/A')).toHaveLength(1)
    expect(result.current.getFileChildren('/A')[0].path).toBe('/A/note.md')
  })
})