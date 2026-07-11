// Web Worker for handling file chunking and hash calculation
// This worker runs in a separate thread to avoid blocking the main UI thread

interface ChunkData {
  chunk: Blob
  index: number
  hash?: string
}

interface WorkerMessage {
  type: 'chunk' | 'hash' | 'progress'
  fileId: string
  data?: any
}

interface ChunkFileMessage {
  type: 'chunkFile'
  fileId: string
  file: File
  chunkSize: number
}

interface HashChunkMessage {
  type: 'hashChunk'
  fileId: string
  chunk: Blob
  index: number
}

// 简单的哈希函数（用于生成文件块的唯一标识）
async function simpleHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// 处理文件分片
async function chunkFile(file: File, chunkSize: number, fileId: string) {
  const totalChunks = Math.ceil(file.size / chunkSize)
  const chunks: ChunkData[] = []

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, file.size)
    const chunk = file.slice(start, end)

    chunks.push({
      chunk,
      index: i
    })

    // 发送进度更新
    self.postMessage({
      type: 'progress',
      fileId,
      data: {
        current: i + 1,
        total: totalChunks,
        progress: ((i + 1) / totalChunks) * 100
      }
    })
  }

  // 发送分片完成消息
  self.postMessage({
    type: 'chunk',
    fileId,
    data: {
      chunks,
      totalChunks
    }
  })
}

// 计算分片哈希
async function hashChunk(chunk: Blob, index: number, fileId: string) {
  try {
    const arrayBuffer = await chunk.arrayBuffer()
    const hash = await simpleHash(arrayBuffer)

    self.postMessage({
      type: 'hash',
      fileId,
      data: {
        index,
        hash,
        size: chunk.size
      }
    })
  } catch (error) {
    self.postMessage({
      type: 'hash',
      fileId,
      data: {
        index,
        error: error instanceof Error ? error.message : 'Hash calculation failed'
      }
    })
  }
}

// 监听主线程消息
self.addEventListener('message', async (event: MessageEvent) => {
  const message = event.data

  switch (message.type) {
    case 'chunkFile':
      const { file, chunkSize, fileId } = message as ChunkFileMessage
      await chunkFile(file, chunkSize, fileId)
      break

    case 'hashChunk':
      const { chunk, index, fileId: hashFileId } = message as HashChunkMessage
      await hashChunk(chunk, index, hashFileId)
      break

    default:
      console.warn('Unknown message type:', message.type)
  }
})

// 导出类型定义供主线程使用
export type { ChunkData, WorkerMessage, ChunkFileMessage, HashChunkMessage }
