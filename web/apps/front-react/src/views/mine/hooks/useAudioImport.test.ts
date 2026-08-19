import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mocks 必须放在 import 被测模块之前
vi.mock('antd', () => ({
  message: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/api/modules/recording', () => ({
  recordingApi: {
    importAudio: vi.fn(),
  },
}))

vi.mock('@/api/modules/files', () => ({
  default: {
    batchUploadFile: vi.fn(),
  },
}))

vi.mock('@/hooks/useBatchProgress', () => ({
  useBatchProgress: () => ({
    waitForComplete: vi.fn().mockResolvedValue(undefined),
  }),
}))

import { message } from 'antd'
import { recordingApi } from '@/api/modules/recording'
import filesApi from '@/api/modules/files'
import { useAudioImport } from './useAudioImport'

const mockEnsureLibraryId = vi.fn().mockResolvedValue('lib-1')
const mockOnSuccess = vi.fn()

// 构造一个指定 size 的 File（不实际分配 buffer）
const makeFile = (name: string, size: number): File => {
  const file = new File(['x'], name, { type: 'audio/mpeg' })
  Object.defineProperty(file, 'size', { value: size, configurable: true })
  return file
}

// 构造 fake FileList
const makeFileList = (files: File[]): FileList => {
  const list = {
    length: files.length,
    item: (i: number) => files[i],
    [Symbol.iterator]: function* () {
      for (const f of files) yield f
    },
  } as unknown as FileList
  for (let i = 0; i < files.length; i++) {
    ;(list as any)[i] = files[i]
  }
  return list
}

// 模拟 input change 事件
const makeChangeEvent = (files: File[]) =>
  ({
    target: { files: makeFileList(files), value: '' },
  }) as unknown as React.ChangeEvent<HTMLInputElement>

describe('useAudioImport — 文件大小上限校验', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureLibraryId.mockClear()
    mockOnSuccess.mockClear()
  })

  it('200MB 上限：单文件 > 上限时跳过并弹 warning，不调 importAudio', async () => {
    const { result } = renderHook(() =>
      useAudioImport({
        ensureLibraryId: mockEnsureLibraryId,
        currentPath: '/',
        onSuccess: mockOnSuccess,
        // 不传 maxSize → 默认 200 MiB
      }),
    )

    await act(async () => {
      await result.current.handleFileChange(
        makeChangeEvent([makeFile('big.mp3', 250 * 1024 * 1024)]),
      )
    })

    expect(message.warning).toHaveBeenCalledTimes(1)
    expect((message.warning as any).mock.calls[0][0]).toMatch(/200\s*MB/)
    expect((message.warning as any).mock.calls[0][0]).toContain('big.mp3')
    expect(recordingApi.importAudio).not.toHaveBeenCalled()
    expect(mockOnSuccess).not.toHaveBeenCalled()
  })

  it('200MB 上限：恰等上限边界允许上传', async () => {
    ;(recordingApi.importAudio as any).mockResolvedValue({
      batch_id: 'b1',
      upload_token: 't1',
      file_mappings: { '/ok.mp3': 'u1' },
    })

    const { result } = renderHook(() =>
      useAudioImport({
        ensureLibraryId: mockEnsureLibraryId,
        currentPath: '/',
        onSuccess: mockOnSuccess,
      }),
    )

    await act(async () => {
      await result.current.handleFileChange(
        makeChangeEvent([makeFile('ok.mp3', 200 * 1024 * 1024)]),
      )
    })

    expect(message.warning).not.toHaveBeenCalled()
    expect(recordingApi.importAudio).toHaveBeenCalledTimes(1)
  })

  it('调用方传入更小的 maxSize 时以调用方为准', async () => {
    const { result } = renderHook(() =>
      useAudioImport({
        ensureLibraryId: mockEnsureLibraryId,
        currentPath: '/',
        onSuccess: mockOnSuccess,
        maxSize: 10 * 1024 * 1024, // 10 MiB
      }),
    )

    await act(async () => {
      await result.current.handleFileChange(
        makeChangeEvent([makeFile('mid.mp3', 50 * 1024 * 1024)]),
      )
    })

    expect(message.warning).toHaveBeenCalledTimes(1)
    expect((message.warning as any).mock.calls[0][0]).toMatch(/10\s*MB/)
    expect(recordingApi.importAudio).not.toHaveBeenCalled()
  })

  it('多文件：仅越界文件被跳过，其余正常上传', async () => {
    ;(recordingApi.importAudio as any).mockResolvedValue({
      batch_id: 'b1',
      upload_token: 't1',
      file_mappings: {
        '/small.mp3': 'u1',
      },
    })

    const { result } = renderHook(() =>
      useAudioImport({
        ensureLibraryId: mockEnsureLibraryId,
        currentPath: '/',
        onSuccess: mockOnSuccess,
      }),
    )

    await act(async () => {
      await result.current.handleFileChange(
        makeChangeEvent([
          makeFile('big.mp3', 250 * 1024 * 1024),
          makeFile('small.mp3', 10 * 1024 * 1024),
        ]),
      )
    })

    expect(message.warning).toHaveBeenCalledTimes(1)
    expect(message.warning).toHaveBeenCalledWith(
      expect.stringContaining('big.mp3'),
    )
    expect(recordingApi.importAudio).toHaveBeenCalledTimes(1)
    expect(filesApi.batchUploadFile).toHaveBeenCalledTimes(1)
  })
})
