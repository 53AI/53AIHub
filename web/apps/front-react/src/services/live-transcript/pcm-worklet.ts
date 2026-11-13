/**
 * PCM 采集 AudioWorklet：麦克风原始采样 → 重采样到 16kHz → postMessage。
 *
 * AudioWorklet 是独立脚本环境：本文件经 Vite `new URL(..., import.meta.url)`
 * 编译为独立 bundle，由 addModule 加载。AudioWorkletProcessor / sampleRate /
 * registerProcessor 是运行时全局，但 TS lib.dom 不含 AudioWorkletGlobalScope
 * 声明，这里自行声明。
 *
 * 重采样两路径（输入采样率 = AudioContext.sampleRate），逻辑全部内联在
 * process 中——实测（Windows + Vite dev）拆成实例方法会导致 processor
 * 静默不实例化（process 从不被调用、无 processorerror），勿拆：
 *   - 整数倍（48000/3=16000）：整除平均抽取（简单低通抗混叠，POC 实测路径）
 *   - 非整数倍（如 44100，AudioContext 48k 不被支持时的降级路径）：相位步进
 *     线性插值，精确到 16kHz（Math.round(44100/16000)=3 会输出 14700Hz，
 *     VAD/whisper 的 16k 假设全错，绝不能用整除近似）
 */

declare var sampleRate: number
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

const TARGET_RATE = 16000
/** 每次发送的输出块大小（1024 样本 = 64ms，与 worker 消费节奏匹配） */
const OUT_CHUNK = 1024

class PcmDownsampleWorklet extends AudioWorkletProcessor {
  /** 整数倍抽取路径（48k）：每 ratio 个输入样本平均成 1 个输出样本 */
  private readonly ratio = Math.max(1, Math.round(sampleRate / TARGET_RATE))
  /** 是否整数倍（48k 走整除平均，非整数倍走线性插值） */
  private readonly isIntegerRatio = Number.isInteger(sampleRate / TARGET_RATE)
  /** 线性插值路径：输入位置相位（相对缓冲区起点，单位 = 输入样本） */
  private phase = 0
  /** 线性插值路径：跨帧输出累积缓冲（每帧只产出 ~47 样本，需攒满 1024 才发送） */
  private outBuf = new Float32Array(4096)
  private outLen = 0
  private buf = new Float32Array(8192)
  private bufLen = 0

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0]
    if (!input || input.length === 0) return true

    if (this.bufLen + input.length > this.buf.length) {
      const next = new Float32Array(Math.max(8192, (this.bufLen + input.length) * 2))
      next.set(this.buf.subarray(0, this.bufLen))
      this.buf = next
    }
    this.buf.set(input, this.bufLen)
    this.bufLen += input.length

    if (this.isIntegerRatio) {
      // 整数倍：整除平均抽取（48k 已验证路径）
      const outChunk = Math.floor(this.bufLen / this.ratio)
      if (outChunk >= OUT_CHUNK) {
        const out = new Float32Array(outChunk)
        for (let i = 0; i < outChunk; i++) {
          let sum = 0
          const base = i * this.ratio
          for (let j = 0; j < this.ratio; j++) sum += this.buf[base + j]
          out[i] = sum / this.ratio
        }
        const consumed = outChunk * this.ratio
        this.buf.copyWithin(0, consumed, this.bufLen)
        this.bufLen -= consumed
        this.port.postMessage(out, [out.buffer])
      }
    } else {
      // 非整数倍：相位步进线性插值（step 个输入样本 → 1 个输出样本）。
      // 保留最后一个输入样本不消费（下一块的插值下界），相位跨块连续。
      // 输出跨帧累积（每帧仅 ~47 样本，攒满 1024 才发送）；
      // consumed 必须钳制到 bufLen：循环退出时 phase 可越过缓冲区末尾
      // （预支了未来样本），不钳制会使 bufLen 变负 → buf.set(input, -1)
      // 抛 RangeError → Chrome 静默停止调用 process（无 processorerror）。
      const step = sampleRate / TARGET_RATE
      while (this.phase + 1 < this.bufLen) {
        const i = Math.floor(this.phase)
        const frac = this.phase - i
        const v = this.buf[i] * (1 - frac) + this.buf[i + 1] * frac
        if (this.outLen >= this.outBuf.length) {
          const next = new Float32Array(this.outBuf.length * 2)
          next.set(this.outBuf)
          this.outBuf = next
        }
        this.outBuf[this.outLen++] = v
        this.phase += step
      }
      const consumed = Math.min(Math.floor(this.phase), this.bufLen)
      if (consumed > 0) {
        this.buf.copyWithin(0, consumed, this.bufLen)
        this.bufLen -= consumed
        this.phase -= consumed
      }
      if (this.outLen >= OUT_CHUNK) {
        const out = this.outBuf.slice(0, this.outLen)
        this.outLen = 0
        this.port.postMessage(out, [out.buffer])
      }
    }
    return true
  }
}

registerProcessor('pcm-downsample-worklet', PcmDownsampleWorklet)
