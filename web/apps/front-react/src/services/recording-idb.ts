/**
 * IndexedDB 录音草稿持久化服务
 * 用于在本地持久化录音数据块和草稿状态
 */

const DB_NAME = 'km-recording'
const STORE_NAME = 'recording-drafts'
const DB_VERSION = 1

/**
 * 音频数据块
 */
export interface ChunkData {
  index: number
  data: ArrayBuffer
  durationMs?: number
  startOffsetMs?: number
  endOffsetMs?: number
}

/**
 * 录音草稿
 */
export interface RecordingDraft {
  recordingId: string
  chunks: ChunkData[]
  startTime: number
  status: 'recording' | 'paused'
  format: string
  name: string
}

/**
 * 打开或创建 IndexedDB 数据库
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`))
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'recordingId' })
      }
    }
  })
}

/**
 * 录音草稿 IndexedDB 服务
 */
export const recordingIdbService = {
  /**
   * 保存录音草稿
   * @param draft 录音草稿数据
   */
  async saveDraft(draft: RecordingDraft): Promise<void> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put(draft)

      request.onerror = () => {
        reject(new Error(`Failed to save draft: ${request.error?.message}`))
      }

      transaction.oncomplete = () => {
        resolve()
      }

      transaction.onerror = () => {
        reject(new Error(`Transaction failed: ${transaction.error?.message}`))
      }
    })
  },

  /**
   * 获取录音草稿
   * @param recordingId 录音ID
   * @returns 录音草稿数据，不存在则返回 null
   */
  async getDraft(recordingId: string): Promise<RecordingDraft | null> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(recordingId)

      request.onerror = () => {
        reject(new Error(`Failed to get draft: ${request.error?.message}`))
      }

      request.onsuccess = () => {
        resolve(request.result || null)
      }
    })
  },

  /**
   * 添加音频数据块到草稿
   * @param recordingId 录音ID
   * @param chunk 音频数据块
   */
  async addChunk(recordingId: string, chunk: ChunkData): Promise<void> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const getRequest = store.get(recordingId)

      getRequest.onerror = () => {
        reject(new Error(`Failed to get draft: ${getRequest.error?.message}`))
      }

      getRequest.onsuccess = () => {
        const draft = getRequest.result as RecordingDraft | undefined
        if (!draft) {
          reject(new Error(`Draft not found: ${recordingId}`))
          return
        }

        // 检查是否存在重复索引
        const existingIndex = draft.chunks.findIndex((c) => c.index === chunk.index)
        if (existingIndex === -1) {
          draft.chunks.push(chunk)
        }

        const putRequest = store.put(draft)
        putRequest.onerror = () => {
          reject(new Error(`Failed to update draft: ${putRequest.error?.message}`))
        }
        // putRequest success is handled by transaction.oncomplete
      }

      transaction.oncomplete = () => {
        resolve()
      }

      transaction.onerror = () => {
        reject(new Error(`Transaction failed: ${transaction.error?.message}`))
      }
    })
  },

  /**
   * 从草稿中移除音频数据块
   * @param recordingId 录音ID
   * @param chunkIndex 数据块索引
   */
  async removeChunk(recordingId: string, chunkIndex: number): Promise<void> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const getRequest = store.get(recordingId)

      getRequest.onerror = () => {
        reject(new Error(`Failed to get draft: ${getRequest.error?.message}`))
      }

      getRequest.onsuccess = () => {
        const draft = getRequest.result as RecordingDraft | undefined
        if (!draft) {
          reject(new Error(`Draft not found: ${recordingId}`))
          return
        }

        // 过滤掉指定索引的数据块
        draft.chunks = draft.chunks.filter((c) => c.index !== chunkIndex)

        const putRequest = store.put(draft)
        putRequest.onerror = () => {
          reject(new Error(`Failed to update draft: ${putRequest.error?.message}`))
        }
      }

      transaction.oncomplete = () => {
        resolve()
      }

      transaction.onerror = () => {
        reject(new Error(`Transaction failed: ${transaction.error?.message}`))
      }
    })
  },

  /**
   * 删除录音草稿
   * @param recordingId 录音ID
   */
  async deleteDraft(recordingId: string): Promise<void> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.delete(recordingId)

      request.onerror = () => {
        reject(new Error(`Failed to delete draft: ${request.error?.message}`))
      }

      transaction.oncomplete = () => {
        resolve()
      }

      transaction.onerror = () => {
        reject(new Error(`Transaction failed: ${transaction.error?.message}`))
      }
    })
  },

  /**
   * 获取所有录音草稿
   * @returns 所有录音草稿列表
   */
  async getAllDrafts(): Promise<RecordingDraft[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onerror = () => {
        reject(new Error(`Failed to get all drafts: ${request.error?.message}`))
      }

      request.onsuccess = () => {
        resolve(request.result || [])
      }
    })
  },

  /**
   * 更新录音草稿状态
   * @param recordingId 录音ID
   * @param status 状态
   */
  async updateStatus(recordingId: string, status: 'recording' | 'paused'): Promise<void> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const getRequest = store.get(recordingId)

      getRequest.onerror = () => {
        reject(new Error(`Failed to get draft: ${getRequest.error?.message}`))
      }

      getRequest.onsuccess = () => {
        const draft = getRequest.result as RecordingDraft | undefined
        if (!draft) {
          reject(new Error(`Draft not found: ${recordingId}`))
          return
        }

        draft.status = status
        const putRequest = store.put(draft)
        putRequest.onerror = () => {
          reject(new Error(`Failed to update draft: ${putRequest.error?.message}`))
        }
      }

      transaction.oncomplete = () => {
        resolve()
      }

      transaction.onerror = () => {
        reject(new Error(`Transaction failed: ${transaction.error?.message}`))
      }
    })
  },

  /**
   * 清理所有录音草稿
   * 用于在开始新录音时清理旧数据
   */
  async clearAllDrafts(): Promise<void> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.clear()

      request.onerror = () => {
        reject(new Error(`Failed to clear all drafts: ${request.error?.message}`))
      }

      transaction.oncomplete = () => {
        resolve()
      }

      transaction.onerror = () => {
        reject(new Error(`Transaction failed: ${transaction.error?.message}`))
      }
    })
  }
}

export default recordingIdbService
