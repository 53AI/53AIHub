/**
 * 录音实时转写 store（端侧，音频不出设备）。
 *
 * 架构对齐移动端 KM-Record 的「第三个订阅者」模式（asr-technical-options.md §6.2）：
 *   订阅1 MediaRecorder → 云端分段上传（recording-bridge，不动）
 *   订阅2 本 store ← bridge 'pcmTap' 事件（同一麦克风流并行消费）
 *     → AudioContext(48k) + AudioWorklet(降采样 16k)
 *     → sherpa-worker（public/asr/sherpa-worker.js，配置驱动）：
 *       silero-vad 切句 → zipformer 流式 / paraformer 整句推理 + wespeaker 声纹
 *     → lines / partial / latestLine → RecordingFloat 渲染
 *
 * 降级红线（对齐移动端 §6.5）：ASR 任何失败（模型未加载/加载失败/推理错误）
 * 只影响转写展示，永不阻断录音主流程。
 *
 * 开关：localStorage `km-live-transcript-disabled=1` 可关闭（默认开启）；
 * 模型首次下载（zipformer 24MB / paraformer 232MB，hf-mirror），IndexedDB 缓存后离线可用。
 */

import { create } from 'zustand'
import type { RecordingBridge } from '@/services/recording-bridge'
import { asr_models_base_url, getPublicPath } from '@/utils/config'
// Vite 打包 worklet 为独立 module bundle，返回其 URL（audioWorklet.addModule 用）
import workletUrl from '@/services/live-transcript/pcm-worklet.ts?worker&url'

const DISABLED_KEY = 'km-live-transcript-disabled'
/** 手动档位覆盖（调试/用户自救：如核显 WebGPU 驱动有数值问题时强制 cpu 档） */
const TIER_OVERRIDE_KEY = 'km-live-transcript-tier'

export type LiveTranscriptStatus = 'idle' | 'loading' | 'running' | 'failed'

export type LiveTranscriptLine = {
  id: number
  speaker: number
  startSec: number
  text: string
}

/** sherpa worker 消息协议（public/asr/sherpa-worker.js，纯 JS 无类型，此处单源定义）
 *  配置驱动三模型（zipformer/paraformer/sensevoice）共用同一协议 */
type WorkerOut =
  | { type: 'status'; stage: 'loading' | 'ready' | 'error'; detail: string }
  | { type: 'vad'; speaking: boolean }
  | { type: 'partial'; text: string }
  /** 句推理耗时上报（首句 first=true：cpu-strong 实测超时降级 cpu-weak） */
  | { type: 'infer'; sec: number; audioSec: number; first: boolean }
  /** native-strong 档：worker VAD 切句后 PCM 回传（transferable），主线程走 IPC 推理 */
  | { type: 'native-sentence'; pcm: Float32Array; speaker: number; similarity: number; startSec: number; endSec: number }
  | { type: 'sentence'; speaker: number; startSec: number; endSec: number; text: string; similarity: number }

type LiveTranscriptState = {
  status: LiveTranscriptStatus
  statusDetail: string
  speaking: boolean
  lines: LiveTranscriptLine[]
  /** zipformer 流式档：当前句未定稿文本（边说边出，定稿进 lines 后清空） */
  partial: string
  /** 模型是否已就绪（跨录音会话复用，避免重复下载） */
  modelReady: boolean
  /** 当前档位（页面加载即判定，不必等录音；实测降级时更新） */
  tier: AsrTier
}

type LiveTranscriptActions = {
  /** bridge 'pcmTap' 到达：接流、起 Worker（幂等，录音开始时调用） */
  attach: (stream: MediaStream) => Promise<void>
  /** 录音结束/中断：断流、清句子（模型与 Worker 保留复用） */
  detach: () => void
  /** 页面级预加载：进安心录即后台拉模型（幂等；失败静默，录音时 attach 再试）。
 *  避免首次录音时模型下载期间（~280MB，几分钟）的语音不被转写 */
  preload: () => void
  isEnabled: () => boolean
}

/**
 * 在 recording store 的 registerBridgeHandlers 里调用（bridge 每次录音都是新实例，
 * 不能模块级订阅）。返回解绑函数。
 */
export function registerLiveTranscriptHandlers(bridge: RecordingBridge): () => void {
  console.info('[live-transcript] ① bridge handler 已注册')
  const offTap = bridge.on('pcmTap', (stream: MediaStream) => {
    console.info('[live-transcript] ② pcmTap 收到流:', stream.id)
    void useLiveTranscriptStore.getState().attach(stream)
  })
  const offStopped = bridge.on('stopped', () => {
    useLiveTranscriptStore.getState().detach()
  })
  const offInterrupted = bridge.on('interrupted', () => {
    useLiveTranscriptStore.getState().detach()
  })
  return () => {
    offTap()
    offStopped()
    offInterrupted()
  }
}

// ============ 模块级单例资源（不进 React 状态） ============

let worker: Worker | null = null
let audioCtx: AudioContext | null = null
let workletNode: AudioWorkletNode | null = null
let lineId = 0
let modelReady = false
let loading = false
/** 当前接流的麦克风流（降级重接流用：WebGPU 实测不达标时换 cpu 档 worker 重新 attach） */
let currentStream: MediaStream | null = null
/** asr_progress 订阅去重（preload 幂等，多次进入页面只订阅一次） */
let asrProgressSubscribed = false

const isDisabled = (): boolean => {
  try {
    return localStorage.getItem(DISABLED_KEY) === '1'
  } catch {
    return false
  }
}

const handleWorkerMessage = (e: MessageEvent<WorkerOut>): void => {
  const msg = e.data
  if (msg.type === 'status') {
    console.info(`[live-transcript] worker 状态: ${msg.stage} — ${msg.detail}`)
    if (msg.stage === 'ready') {
      modelReady = true
      loading = false
      // 模型就绪 ≠ 链路通：接流已失败（AudioContext/Worklet 异常）时保持 failed，
      // 否则 UI 显示正常但永远没字幕；下次 attach 成功会重新置 running
      useLiveTranscriptStore.setState((s) =>
        s.status === 'failed'
          ? { modelReady: true }
          : { status: 'running', statusDetail: msg.detail, modelReady: true },
      )
    } else if (msg.stage === 'loading') {
      // 同上：接流失败后不再被后续 loading 进度拉回，避免 failed → loading 抖动
      useLiveTranscriptStore.setState((s) =>
        s.status === 'failed' ? { statusDetail: msg.detail } : { status: 'loading', statusDetail: msg.detail },
      )
    } else if (msg.stage === 'error') {
      loading = false
      useLiveTranscriptStore.setState({ status: 'failed', statusDetail: msg.detail })
    }
  } else if (msg.type === 'vad') {
    useLiveTranscriptStore.setState({ speaking: msg.speaking })
  } else if (msg.type === 'partial') {
    // zipformer 流式档：当前句未定稿文本，实时刷新悬浮条（定稿后由 sentence 清空）
    useLiveTranscriptStore.setState({ partial: msg.text })
  } else if (msg.type === 'infer' && msg.first) {
    // 首句推理耗时实测兑底（静态检测必然误判，实测才是裁判）：
    // cpu-strong 超 3s = 逻辑核高估了算力（超线程加成远低于物理核，
    // i3 4核8线程被判 8 核），paraformer 句级延迟不可用 → 降 zipformer 流式
    if (tierCache === 'cpu-strong' && msg.sec > 3) {
      console.warn(
        `[live-transcript] paraformer 首句推理 ${msg.sec.toFixed(1)}s 超阈值（3s），CPU 算力不足，自动降级 cpu-weak（zipformer 流式）`,
      )
      downgradeToCpu('cpu-weak')
    }
  } else if (msg.type === 'native-sentence') {
    // native-strong 档：worker 已完成 VAD 切句 + 声纹聚类，PCM 转主进程 Qwen3-ASR 推理
    transcribeViaDesktop(msg)
  } else if (msg.type === 'sentence') {
    lineId += 1
    const line: LiveTranscriptLine = { id: lineId, speaker: msg.speaker, startSec: msg.startSec, text: msg.text }
    const { lines } = useLiveTranscriptStore.getState()
    // 上限 500 句防内存膨胀（约 1-2 小时会议）
    const next = lines.length >= 500 ? [...lines.slice(-499), line] : [...lines, line]
    useLiveTranscriptStore.setState({ lines: next, partial: '' })
  }
}

/** native 档 IPC 串行队列：主进程 InferenceSession 单实例，多句并发会乱序+
 *  内存翻倍，promise 链保序。首句实测兑底：>5s（982MB 模型阈值放宽）降 cpu-strong，
 *  由其首句 >3s 再降 cpu-weak 的现有机制接力。IPC 异常同样降 cpu-strong。 */
let nativeQueue: Promise<void> = Promise.resolve()
let nativeInferReported = false

function transcribeViaDesktop(msg: Extract<WorkerOut, { type: 'native-sentence' }>): void {
  const desktop =
    typeof window !== 'undefined'
      ? (window as { erhaoDesktop?: ErhaoDesktopLike }).erhaoDesktop
      : undefined
  if (!desktop?.asrTranscribe) {
    console.warn('[live-transcript] native 档无 asrTranscribe 桥，降级 cpu-strong')
    downgradeToCpu('cpu-strong')
    return
  }
  const transcribe = desktop.asrTranscribe
  nativeQueue = nativeQueue
    .then(async () => {
      const t0 = performance.now()
      const r = await transcribe(msg.pcm)
      const sec = (performance.now() - t0) / 1000
      if (!nativeInferReported) {
        nativeInferReported = true
        console.info(`[live-transcript] Qwen3-ASR 首句推理 ${sec.toFixed(1)}s（音频 ${msg.endSec - msg.startSec}s）`)
        if (sec > 5) {
          console.warn(`[live-transcript] Qwen3-ASR 首句推理 ${sec.toFixed(1)}s 超阈值（5s），降级 cpu-strong（paraformer）`)
          downgradeToCpu('cpu-strong')
          return
        }
      }
      const text = (r.text ?? '').trim()
      if (!text) return
      lineId += 1
      const line: LiveTranscriptLine = { id: lineId, speaker: msg.speaker, startSec: msg.startSec, text }
      const { lines } = useLiveTranscriptStore.getState()
      const next = lines.length >= 500 ? [...lines.slice(-499), line] : [...lines, line]
      useLiveTranscriptStore.setState({ lines: next, partial: '' })
    })
    .catch((err) => {
      console.warn('[live-transcript] Qwen3-ASR 推理失败，降级 cpu-strong:', err)
      downgradeToCpu('cpu-strong')
    })
}

async function ensureWorker(): Promise<Worker> {
  if (worker) return worker
  // sherpa 系统一 worker（配置驱动，见 public/asr/sherpa-worker.js）：
  // 经典 worker（importScripts 加载 UMD 引擎），load 时按档位传模型 key
  worker = new Worker(`${getPublicPath('asr')}/sherpa-worker.js`)
  worker.onmessage = (e: MessageEvent<WorkerOut>) => handleWorkerMessage(e)
  return worker
}

/** 档位缓存：检测有开销，attach/preload 共用一次结果；同步到 store.tier 供 UI 展示 */
let tierCache: AsrTier | null = null
async function ensureTier(): Promise<AsrTier> {
  if (tierCache) return tierCache
  tierCache = await pickTier()
  useLiveTranscriptStore.setState({ tier: tierCache })
  return tierCache
}

/** 实测不达标 → 降级并重接流（tier 指定目标档）：
 *  换对应 worker 重新加载，录音中已说的话丢失（降级前无产出），
 *  之后实时恢复。降级决策缓存到 tierCache，本次会话不再回高档。 */
function downgradeToCpu(tier: 'cpu-strong' | 'cpu-weak'): void {
  try {
    worker?.terminate()
  } catch {
    // terminate 失败忽略（worker 可能已退出）
  }
  worker = null
  modelReady = false
  loading = false
  tierCache = tier
  useLiveTranscriptStore.setState({ tier })
  if (currentStream) {
    void useLiveTranscriptStore.getState().attach(currentStream)
  } else {
    // 无流（预加载阶段发现）：下次录音生效
    useLiveTranscriptStore.setState({ status: 'idle', statusDetail: '' })
  }
}

async function ensureModel(w: Worker, tier: AsrTier): Promise<void> {
  if (modelReady || loading) return
  loading = true
  useLiveTranscriptStore.setState({ status: 'loading', statusDetail: '加载转写模型…' })
  // 模型同源自托管（public/models/，对齐 loadLib 模式）；worker 内无 window，主线程算好路径传入
  // 模型基址：同源 public 或 CDN（window.asr_models_base_url / VITE_ASR_MODELS_BASE_URL 可覆盖）
  // native-strong → worker 只加载 VAD+声纹（推理在主进程）；cpu-strong → paraformer-large；cpu-weak → zipformer
  const model = tier === 'native-strong' ? 'native' : tier === 'cpu-strong' ? 'paraformer' : 'zipformer'
  w.postMessage({ type: 'load', model, modelsBaseUrl: asr_models_base_url })
}

/** 桌面端 bridge（Electron preload 注入，见 53ai-desktop electron/preload.js） */
type ErhaoDesktopLike = {
  getEnvironment?: () => Promise<{
    isDesktop: boolean
    platform: string
    appVersion: string
    cpuCores?: number
    memGB?: number
    cpuModel?: string
  }>
  /** 端侧 ASR（native-strong 档，Qwen3-ASR 主进程原生推理） */
  asrStatus?: () => Promise<{ state: string; progress: number; error?: string; installed?: boolean }>
  asrEnsure?: () => Promise<{ state: string; progress: number; error?: string }>
  asrTranscribe?: (samples: Float32Array) => Promise<{ text: string; durationMs: number }>
  onAsrProgress?: (cb: (st: { state: string; progress: number; error?: string }) => void) => () => void
}

/** ASR 设备档位（浏览器统一 sherpa 系，whisper WebGPU 档已下线——消费级核显
 *  实测不可靠：慢/驱动数值错/UI 卡，误判面大；强 GPU 用户由 paraformer 质量覆盖）
 *  - native-strong：Electron + 内存≥16GB + 模型已就绪 → worker VAD/声纹 +
 *    主进程 Qwen3-ASR 0.6B 原生推理（质量四档最高，LLM 级纠错+标点）
 *  - cpu-strong：≥8 逻辑核 → paraformer-large（句级 0.3-1.6s，专有名词质量最优）
 *  - cpu-weak：弱机 → zipformer zh-14M（24MB 流式，边说边出，弱机实时）
 *  实测兑底：cpu-strong 首句推理 >3s 自动降级 cpu-weak（逻辑核高估算力，
 *  如 i3 4核8线程被判 8 核；超线程对推理加成远低于物理核） */
export type AsrTier = 'native-strong' | 'cpu-strong' | 'cpu-weak'

/** 档位判定：Electron native-strong 优先，否则 CPU 核数（桌面端真实硬件优先，
 *  浏览器 hardwareConcurrency 兜底）。静态检测必然误判，实测兑底才是裁判。 */
async function pickTier(): Promise<AsrTier> {
  // 手动覆盖优先（localStorage：native-strong / cpu-strong / cpu-weak）——自动判断不合意时的自救开关
  try {
    const override = localStorage.getItem(TIER_OVERRIDE_KEY)
    if (override === 'native-strong' || override === 'cpu-strong' || override === 'cpu-weak') {
      console.info(`[live-transcript] 档位: ${override}（localStorage 手动覆盖）`)
      return override
    }
  } catch {
    // localStorage 不可用时走自动检测
  }
  // 桌面端配置优先（虚拟机/远程桌面下浏览器 API 可能失真）
  const desktop =
    typeof window !== 'undefined'
      ? (window as { erhaoDesktop?: ErhaoDesktopLike }).erhaoDesktop
      : undefined
  const env = await desktop?.getEnvironment?.().catch(() => null)
  // Electron native-strong：内存≥16GB 且主进程 Qwen3-ASR 已就绪（preload 触发
  // asrEnsure 后台下载，下载中不阻塞档位判定——期间用浏览器档，完成后下次录音生效）
  if (desktop?.asrStatus && env?.memGB && env.memGB >= 16) {
    const st = await desktop.asrStatus().catch(() => null)
    if (st?.state === 'ready') {
      console.info(`[live-transcript] 档位: native-strong（Electron 主进程 Qwen3-ASR，${env.cpuModel ?? ''}）`)
      return 'native-strong'
    }
  }
  const cores = env?.cpuCores ?? (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4)
  console.info(
    `[live-transcript] 档位: ${cores >= 8 ? 'cpu-strong' : 'cpu-weak'}（cores=${cores}${env?.cpuModel ? '，' + env.cpuModel : ''}）`,
  )
  return cores >= 8 ? 'cpu-strong' : 'cpu-weak'
}

// ============ store ============

export const useLiveTranscriptStore = create<LiveTranscriptState & LiveTranscriptActions>()((set, get) => ({
  status: 'idle',
  statusDetail: '',
  speaking: false,
  lines: [],
  partial: '',
  modelReady: false,
  tier: 'cpu-weak',

  attach: async (stream: MediaStream) => {
    if (isDisabled()) {
      console.info('[live-transcript] 已被 localStorage 开关关闭')
      return
    }
    try {
      console.info('[live-transcript] ③ attach 开始')
      // 上一路未清理时先清（快速连续开始录音的边界）
      get().detach()

      const tier = await ensureTier()
      const w = await ensureWorker()
      console.info(`[live-transcript] ④ worker 就绪（${tier}）`)
      await ensureModel(w, tier)
      w.postMessage({ type: 'reset', knownK: null })

      // 48k 是 worklet 整除抽取的最优路径；某些声卡/蓝牙驱动不支持时降级
      // 默认采样率（如 44100），worklet 走线性插值精确重采样，链路不受影响
      let ctx: AudioContext
      try {
        ctx = new AudioContext({ sampleRate: 48000 })
      } catch {
        console.warn(`[live-transcript] AudioContext 48k 不被支持，降级默认采样率（worklet 走插值重采样）`)
        ctx = new AudioContext()
      }
      await ctx.resume()
      await ctx.audioWorklet.addModule(workletUrl)
      console.info('[live-transcript] ⑤ worklet 已加载')
      // 麦克风实际配置（蓝牙 HFP 常见 8k/16k；采样率异常直接影响 VAD/识别）
      const track = stream.getAudioTracks()[0]
      if (track) {
        const st = track.getSettings()
        console.info(
          `[live-transcript] 麦克风: sampleRate=${st.sampleRate ?? '?'}Hz echoCancellation=${st.echoCancellation ?? '?'} noiseSuppression=${st.noiseSuppression ?? '?'} | AudioContext=${ctx.sampleRate}Hz`,
        )
      }
      const source = ctx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(ctx, 'pcm-downsample-worklet')
      // 输入 RMS 自检（每 5s 一次共 6 次）：区分「无声音进来」（设备/权限/降噪误杀）
      // 与「有声音但 VAD 不开嗓」（语音质量/采样率问题）
      let rmsSum = 0
      let rmsN = 0
      let rmsLogAt = Date.now() + 5000
      let rmsLogs = 0
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (rmsLogs < 6) {
          const d = e.data
          for (let i = 0; i < d.length; i += 31) {
            rmsSum += d[i] * d[i]
            rmsN++
          }
          if (Date.now() > rmsLogAt) {
            const rms = Math.sqrt(rmsSum / Math.max(1, rmsN))
            console.info(
              `[live-transcript] 输入 RMS=${rms.toFixed(4)}${rms < 0.001 ? '（疑似静音：设备被占用/降噪误杀/权限）' : ''}`,
            )
            rmsSum = 0
            rmsN = 0
            rmsLogAt = Date.now() + 5000
            rmsLogs++
          }
        }
        w.postMessage({ type: 'pcm', data: e.data }, [e.data.buffer])
      }
      source.connect(node)
      audioCtx = ctx
      workletNode = node
      currentStream = stream
      lineId = 0
      set({ lines: [], speaking: false, partial: '', status: modelReady ? 'running' : 'loading' })
      console.info('[live-transcript] ⑥ 接流完成，等待语音')
    } catch (err) {
      // 降级红线：任何失败不抛出，录音继续
      console.warn('[live-transcript] 接流失败（录音不受影响）:', err)
      set({ status: 'failed', statusDetail: err instanceof Error ? err.message : String(err) })
    }
  },

  detach: () => {
    try {
      workletNode?.disconnect()
      workletNode = null
      void audioCtx?.close()
      audioCtx = null
    } catch {
      // 忽略清理异常
    }
    set({ speaking: false, partial: '' })
  },

  preload: () => {
    if (isDisabled()) return
    // Electron：触发主进程 Qwen3-ASR 下载/加载（982MB，后台；完成后下次录音升 native-strong）。
    // 下载中不阻塞浏览器档预加载——用户当下录音用浏览器档，模型就绪后无缝升级。
    const desktop =
      typeof window !== 'undefined'
        ? (window as { erhaoDesktop?: ErhaoDesktopLike }).erhaoDesktop
        : undefined
    if (desktop?.asrEnsure && !asrProgressSubscribed) {
      asrProgressSubscribed = true
      void desktop.asrEnsure().catch(() => {})
      desktop.onAsrProgress?.((st) => {
        if (st.state === 'downloading') {
          console.info(`[live-transcript] Qwen3-ASR 模型下载 ${(st.progress * 100).toFixed(0)}%`)
        } else if (st.state === 'ready') {
          // 就绪后刷新档位缓存；录音中不打断（降级红线），下次 attach 生效
          console.info('[live-transcript] Qwen3-ASR 就绪，下次录音启用 native-strong')
          tierCache = null
          void ensureTier()
        } else if (st.state === 'error') {
          console.warn('[live-transcript] Qwen3-ASR 加载失败（浏览器档不受影响）:', st.error)
        }
      })
    }
    if (modelReady || loading) return
    console.info('[live-transcript] 预加载：提前拉取转写模型')
    void (async () => {
      try {
        const tier = await ensureTier()
        const w = await ensureWorker()
        await ensureModel(w, tier)
      } catch (err) {
        // 降级红线：预加载失败不影响页面，录音开始时 attach 会重试
        console.warn('[live-transcript] 预加载失败（录音时会重试）:', err)
      }
    })()
  },

  isEnabled: () => !isDisabled(),
}))

// 模块加载即预判档位（纯本地检测，零成本；不必等 preload/录音）——
// UI 可立即展示当前引擎，用户进页面就知道自己是 paraformer 还是 zipformer
void ensureTier()
