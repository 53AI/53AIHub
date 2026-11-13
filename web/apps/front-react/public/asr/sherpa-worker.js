/**
 * sherpa-onnx 引擎 Worker（配置驱动，经典 worker + importScripts）。
 *
 * 一套引擎（sherpa-onnx-wasm-web）支持多模型，MODEL_CONFIGS 配置表驱动：
 *   zipformer  : online  流式 transducer（zh-14M 24MB，弱机档）→ partial 边说边出
 *   paraformer : offline 句级（paraformer-large 232MB，cpu-strong 档）→ VAD 切句整句推理
 *   sensevoice : offline 句级（SenseVoice-small 228MB，备选）→ 同 paraformer 管线
 *
 * 为什么是经典 worker 而非 module worker：sherpa 引擎是 Emscripten UMD
 * （var SherpaOnnx = ...; module.exports = ...），module worker 的 ESM import
 * 拿不到无 export 的 UMD 全局，importScripts 又被 module worker 禁用——只能走
 * 经典 worker。故本文件是纯 JS（不经 Vite 编译），随 public/asr/ 入库部署；
 * 引擎与模型在 public/models/<dir>/（gitignore，download-asr-models.mjs 下发）。
 *
 * 流式管线（online）：acceptWaveform → while(isReady) decode → getResult
 *   （partial 实时上报）→ isEndpoint 定稿 sentence → reset 开新句
 * 非流式管线（offline）：silero-VAD 切句（开嗓/句尾状态机，对齐 asr.worker.ts
 *   参数）→ 句尾整句 OfflineRecognizer 推理 → sentence。无 partial（句级延迟）。
 *
 * 消息协议（与 asr.worker.ts 对齐，store 统一处理）：
 *   主 → worker：{ type: 'load', model, modelsBaseUrl } | { type: 'pcm', data }
 *              | { type: 'reset' }
 *   worker → 主：{ type: 'status', stage, detail } | { type: 'partial', text }
 *              | { type: 'sentence', speaker, startSec, endSec, text, similarity }
 */

/* eslint-disable */
var SAMPLE_RATE = 16000

// ============ 模型配置表（新增模型 = 加一项；引擎/管线零改动） ============

var MODEL_CONFIGS = {
  // 流式 zipformer zh-14M（弱机档）：24MB，边说边出
  zipformer: {
    type: 'online',
    dir: 'sherpa',
    files: [
      'encoder-epoch-99-avg-1.int8.onnx',
      'decoder-epoch-99-avg-1.int8.onnx',
      'joiner-epoch-99-avg-1.int8.onnx',
      'tokens.txt',
    ],
    buildConfig: function (dir) {
      return {
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
          transducer: {
            encoder: dir + '/encoder-epoch-99-avg-1.int8.onnx',
            decoder: dir + '/decoder-epoch-99-avg-1.int8.onnx',
            joiner: dir + '/joiner-epoch-99-avg-1.int8.onnx',
          },
          tokens: dir + '/tokens.txt',
          numThreads: 1,
          provider: 'cpu',
          debug: 0,
          modelType: '',
          modelingUnit: 'cjkchar',
          bpeVocab: '',
        },
        decodingMethod: 'greedy_search',
        maxActivePaths: 4,
        // endpoint（句尾检测，安卓端同值）：rule1 句尾静音 1.2s 定稿
        enableEndpoint: 1,
        rule1MinTrailingSilence: 1.2,
        rule2MinTrailingSilence: 2.4,
        rule3MinUtteranceLength: 20,
        hotwordsFile: '',
        hotwordsScore: 1.5,
        ctcFstDecoderConfig: { graph: '', maxActive: 3000 },
        ruleFsts: '',
        ruleFars: '',
      }
    },
  },

  // 非流式 paraformer-large（cpu-strong 档）：232MB，FunASR 中文质量档
  paraformer: {
    type: 'offline',
    dir: 'paraformer',
    files: ['model.int8.onnx', 'tokens.txt'],
    buildConfig: function (dir) {
      return {
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
          paraformer: { model: dir + '/model.int8.onnx' },
          tokens: dir + '/tokens.txt',
          numThreads: 1,
          provider: 'cpu',
          debug: 0,
        },
        decodingMethod: 'greedy_search',
      }
    },
  },

  // 非流式 SenseVoice-small（备选，另一会话验证 RTF 0.153）：228MB
  sensevoice: {
    type: 'offline',
    dir: 'sensevoice',
    files: ['model.int8.onnx', 'tokens.txt'],
    buildConfig: function (dir) {
      return {
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
          senseVoice: {
            model: dir + '/model.int8.onnx',
            useInverseTextNormalization: 1,
          },
          tokens: dir + '/tokens.txt',
          numThreads: 1,
          provider: 'cpu',
          debug: 0,
        },
        decodingMethod: 'greedy_search',
      }
    },
  },

  // native-strong 档（Electron 专属）：worker 只跑 VAD 切句 + wespeaker 声纹聚类，
  // 不加载 ASR 模型；句尾 PCM 回传主线程 → IPC asr_transcribe →
  // Electron 主进程 Qwen3-ASR 0.6B 原生推理（质量四档最高，LLM 级纠错+标点）。
  // 引擎/声纹模型复用 sherpa 目录（与 zipformer 档同源）。
  native: {
    type: 'native',
    dir: 'sherpa',
    files: [],
    buildConfig: function () {
      return null
    },
  },
}

// ============ 说话人分离（句级声纹 + 增量聚类）============

// 声纹启用条件：offline 档（cpu-strong，内存余量够）且 wespeaker 模型就位；
// online 档（cpu-weak 弱机）不启用——wespeaker 26MB 双副本 +80MB 内存超红线。
// 声纹模型：wespeaker-cnceleb-resnet34-LM（256 维，中文 CN-Celeb，判别余量 0.300）

var embeddingExtractor = null
var cluster = null

/** K 未知时新建说话人的相似度阈值（cnceleb 实测同人 ≥0.995 / 异人 ≤0.695，0.45 落间隙中部） */
var AUTO_NEW_SPEAKER_SIM = 0.45
/** 中心 EMA 更新系数 */
var CENTER_EMA = 0.2

/** 墰量聚类（从 asr.worker.ts SpeakerCluster 移植，纯 JS）：
 *  首句开第一个中心；后续 cosine 最大者归属，低于阈值新建；
 *  归属时 EMA 更新中心（越用越准）。 */
function SpeakerCluster() {
  this.centers = []
  this.counts = []
}

SpeakerCluster.prototype.classify = function (embRaw) {
  var emb = normalizeVec(embRaw)
  if (this.centers.length === 0) {
    this.centers.push(emb)
    this.counts.push(1)
    return { speaker: 0, similarity: 1 }
  }
  var best = 0
  var bestSim = -1
  for (var i = 0; i < this.centers.length; i++) {
    var sim = cosineVec(emb, this.centers[i])
    if (sim > bestSim) {
      bestSim = sim
      best = i
    }
  }
  if (bestSim < AUTO_NEW_SPEAKER_SIM) {
    this.centers.push(emb)
    this.counts.push(1)
    return { speaker: this.centers.length - 1, similarity: 1 }
  }
  // EMA 更新中心
  var center = this.centers[best]
  for (var j = 0; j < emb.length; j++) {
    center[j] = center[j] * (1 - CENTER_EMA) + emb[j] * CENTER_EMA
  }
  normalizeVec(center, true)
  this.counts[best]++
  return { speaker: best, similarity: bestSim }
}

SpeakerCluster.prototype.reset = function () {
  this.centers = []
  this.counts = []
}

function normalizeVec(v, inPlace) {
  var out = inPlace ? v : new Float32Array(v)
  var norm = 0
  for (var i = 0; i < v.length; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm) || 1
  for (var j = 0; j < out.length; j++) out[j] /= norm
  return out
}

function cosineVec(a, b) {
  var s = 0
  for (var i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** 句级声纹：整句提嵌入 + 聚类归属。短句（<2s 声纹不稳）返回 null 沿用上句标签。 */
var lastSpeaker = 0
function classifySpeaker(audio) {
  if (!embeddingExtractor) return null
  // 声纹不稳红线：句子 <2s（约 200 帧）不参与聚类，沿用上句标签
  if (audio.length < SAMPLE_RATE * 2) return null
  var s = null
  try {
    s = embeddingExtractor.createStream()
    s.acceptWaveform(SAMPLE_RATE, audio)
    if (!embeddingExtractor.isReady(s)) return null
    var emb = embeddingExtractor.computeEmbedding(s)
    var r = cluster.classify(emb)
    lastSpeaker = r.speaker
    return r
  } catch (err) {
    console.info('[sherpa] 声纹异常（降级沿用上句标签）: ' + (err && err.message ? err.message : String(err)))
    return null
  } finally {
    if (s) {
      try { s.free() } catch (e) { /* 忽略 */ }
    }
  }
}

// ============ 运行时状态 ============

var currentModel = null   // 当前配置（MODEL_CONFIGS[key]）
var recognizer = null
var stream = null
var totalSamples = 0
var sessionEpoch = 0
var busy = false          // offline 档：句推理中（推理期间新段丢弃，POC 简化）

// 流式档状态
var sentenceStartSec = 0
var lastPartial = ''

// 非流式档：silero-VAD 段级检测（sherpa Vad 封装内置开嗓/闭嗓/padding 状态机）
var vadModel = null

function post(obj, transfer) {
  self.postMessage(obj, transfer || [])
}

function postStatus(stage, detail) {
  post({ type: 'status', stage: stage, detail: detail })
}

self.onmessage = function (e) {
  var msg = e.data
  try {
    if (msg.type === 'load') {
      loadModels(msg.model, msg.modelsBaseUrl)
    } else if (msg.type === 'reset') {
      resetState()
    } else if (msg.type === 'pcm') {
      // load 完成前的 pcm 静默丢弃（正常场景：预加载期间录音开始）
      if (!currentModel) return
      // native 档无 recognizer/stream（推理在主进程），VAD 就绪即消费
      if (currentModel.type !== 'native' && (!recognizer || !stream)) return
      if (currentModel.type === 'online') {
        consumePcmOnline(msg.data)
      } else {
        consumePcmOffline(msg.data)
      }
    }
  } catch (err) {
    // onmessage 顶层异常静默会吞掉一切线索（worker console 不透传主页面），必须上报
    postStatus('error', '消息处理异常[' + msg.type + ']: ' + (err && err.message ? err.message : String(err)))
  }
}

function fetchModel(base, file) {
  return fetch(base + '/' + file).then(function (res) {
    if (!res.ok) throw new Error(file + ' HTTP ' + res.status)
    return res.arrayBuffer()
  })
}

function loadModels(modelKey, modelsBaseUrl) {
  var cfg = MODEL_CONFIGS[modelKey]
  if (!cfg) {
    postStatus('error', '未知模型: ' + modelKey)
    return
  }
  var base = (modelsBaseUrl || '/models').replace(/\/$/, '') + '/' + cfg.dir
  Promise.resolve()
    .then(function () {
      postStatus('loading', '加载 ' + modelKey + ' 引擎…')
      // importScripts 完整 URL：引擎 JS 所在目录决定 wasm 解析路径
      importScripts(base + '/sherpa-onnx-wasm-web.js', base + '/sherpa-onnx-asr.js')
      // MODULARIZE 工厂。必须传 locateFile——Emscripten 用 worker 自身 URL
      // 推导 scriptDirectory，不覆盖会去 /asr/ 找 wasm 而 404
      return SherpaOnnx({
        locateFile: function (path) { return base + '/' + path },
        // wasm 内部 stdout/stderr 透传（onnxruntime/sherpa abort 前的错误消息
        // 只走这里；abort 后再进 wasm 解码指针会挂死，必须在源头接）
        print: function (t) { if (String(t).indexOf('wasm') < 0) postStatus('loading', '[wasm] ' + t) },
        printErr: function (t) { postStatus('error', '[wasm-err] ' + t) },
      })
    })
    .then(function (Module) {
      postStatus('loading', '下载 ' + modelKey + ' 模型…')
      var files = cfg.files.slice()
      // 非流式/native 档：VAD 切句需要 silero 模型
      if (cfg.type === 'offline' || cfg.type === 'native') files.push('silero-vad.onnx')
      // 说话人分离：wespeaker 声纹模型（offline/native 档；online 弱机档内存红线不启用）
      var withSpeaker = cfg.type === 'offline' || cfg.type === 'native'
      if (withSpeaker) files.push('wespeaker.onnx')
      return Promise.all(files.map(function (f) { return fetchModel(base, f) }))
        .then(function (bufs) {
          for (var i = 0; i < files.length; i++) {
            Module.FS.writeFile('/' + files[i], new Uint8Array(bufs[i]))
          }
          return Module
        })
    })
    .then(function (Module) {
      postStatus('loading', '初始化识别器…')
      currentModel = cfg
      var config = cfg.buildConfig('/')
      if (cfg.type === 'online') {
        recognizer = createOnlineRecognizer(Module, config)
      } else {
        // native 档不创建 ASR recognizer（推理在 Electron 主进程），只初始化 VAD + 声纹
        if (cfg.type !== 'native') {
          postStatus('loading', '初始化 OfflineRecognizer…')
          recognizer = new OfflineRecognizer(config, Module)
        }
        postStatus('loading', '初始化 VAD…')
        // silero-VAD 段级检测（sherpa 配套 644KB 版模型，scripts/assets/ 下发）
        importScripts(base + '/sherpa-onnx-vad.js')
        vadModel = createVad(Module, {
          sileroVad: { model: '/silero-vad.onnx' },
          sampleRate: SAMPLE_RATE,
          windowSize: 512,
          threshold: 0.5,
        })
        postStatus('loading', 'VAD 就绪')
        // 说话人分离：声纹提取器 + 聚类（wespeaker.onnx 已随模型下发写入 MEMFS）。
        // 降级红线：声纹初始化失败（如旧版 wasm 未导出 embedding API）不阻断转写，
        // 仅说话人标签退化为恒 0；新 wasm（km-web 构建）到位后自动启用。
        try {
          importScripts('speaker-embedding.js')
          embeddingExtractor = createSpeakerEmbeddingExtractor(Module, {
            model: '/wespeaker.onnx',
            numThreads: 1,
            debug: 0,
            provider: 'cpu',
          })
          cluster = new SpeakerCluster()
          postStatus('loading', '声纹就绪：dim=' + embeddingExtractor.getDim())
        } catch (embErr) {
          embeddingExtractor = null
          postStatus('loading', '声纹不可用（降级：说话人标签恒 0）：' + (embErr && embErr.message ? embErr.message : String(embErr)))
        }
      }
      if (recognizer) stream = recognizer.createStream()
      postStatus(
        'ready',
        modelKey +
          ' 就绪（' +
          (cfg.type === 'online'
            ? '流式，边说边出'
            : cfg.type === 'native'
              ? '句级，主进程 Qwen3-ASR 推理' + (embeddingExtractor ? '+说话人' : '')
              : '句级，VAD 切句' + (embeddingExtractor ? '+说话人' : '')) +
          ')',
      )
    })
    .catch(function (err) {
      // wasm abort 抛的是指针（数字）：用 UTF8ToString 解码真实错误消息
      postStatus('error', modelKey + ' 加载失败：' + (err && err.message ? err.message : String(err)))
    })
}

function resetState() {
  sessionEpoch++
  totalSamples = 0
  sentenceStartSec = 0
  lastPartial = ''
  busy = false
  lastSpeaker = 0
  if (cluster) cluster.reset()
  // reset 仅 OnlineRecognizer 有；OfflineRecognizer 每句独立 createStream/free
  // 无需重置（epoch 守卫已丢弃旧会话在途结果）
  if (currentModel && currentModel.type === 'online' && recognizer && stream) {
    recognizer.reset(stream)
  }
  if (vadModel) vadModel.clear()
}

// ============ 流式管线（online：zipformer） ============

function consumePcmOnline(pcm) {
  var epoch = sessionEpoch
  try {
    // JS 版签名：acceptWaveform(sampleRate, samples)（顺序勿反，反了除零）
    stream.acceptWaveform(SAMPLE_RATE, pcm)
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream)
    }
    var text = recognizer.getResult(stream).text
    if (text && text !== lastPartial) {
      lastPartial = text
      post({ type: 'partial', text: text })
    }
    if (recognizer.isEndpoint(stream)) {
      if (text && epoch === sessionEpoch) {
        post({
          type: 'sentence',
          speaker: 0,
          startSec: sentenceStartSec,
          endSec: totalSamples / SAMPLE_RATE,
          text: text,
          similarity: 1.0,
        })
      }
      recognizer.reset(stream)
      lastPartial = ''
      sentenceStartSec = totalSamples / SAMPLE_RATE
    }
    totalSamples += pcm.length
  } catch (err) {
    postStatus('error', '推理异常：' + (err && err.message ? err.message : String(err)))
  }
}

// ============ 非流式管线（offline：paraformer / sensevoice） ============
// sherpa Vad 段级 API：acceptWaveform 喂 PCM，检测到完整语音段（内置开嗓/
// 闭嗓/padding 状态机）后入队，front() 取 {samples, start} 整段推理。

function consumePcmOffline(pcm) {
  var epoch = sessionEpoch
  try {
    vadModel.acceptWaveform(pcm)
    // speaking 状态上报（悬浮条「聆听中」指示）
    var detected = vadModel.isDetected()
    if (detected !== lastDetected) {
      lastDetected = detected
      post({ type: 'vad', speaking: detected })
    }
    while (!vadModel.isEmpty()) {
      var seg = vadModel.front()
      vadModel.pop()
      if (seg.samples.length >= SAMPLE_RATE * 0.2 && epoch === sessionEpoch) {
        transcribeOffline(seg.samples, seg.start / SAMPLE_RATE)
      }
    }
    totalSamples += pcm.length
  } catch (err) {
    postStatus('error', '推理异常：' + (err && err.message ? err.message : String(err)))
  }
}

var lastDetected = false
/** 首句推理耗时已上报（store 据此做性能自检，仅首句） */
var inferReported = false

function transcribeOffline(audio, startSec) {
  // native-strong 档：VAD/声纹在 worker，推理走 Electron 主进程 IPC。
  // PCM transferable 回传（零拷贝），主线程串行队列保序。
  if (currentModel.type === 'native') {
    var sp = classifySpeaker(audio)
    var speaker = sp ? sp.speaker : lastSpeaker
    var similarity = sp ? sp.similarity : 0
    if (sp) lastSpeaker = sp.speaker
    post(
      {
        type: 'native-sentence',
        pcm: audio,
        speaker: speaker,
        similarity: similarity,
        startSec: startSec,
        endSec: startSec + audio.length / SAMPLE_RATE,
      },
      [audio.buffer],
    )
    return
  }
  if (busy) {
    console.info('[sherpa] 丢弃句子 @' + startSec.toFixed(1) + 's：上句推理中（busy）')
    return
  }
  busy = true
  try {
    var t0 = performance.now()
    var s = recognizer.createStream()
    s.acceptWaveform(SAMPLE_RATE, audio)
    recognizer.decode(s)
    var result = recognizer.getResult(s)
    s.free()
    var inferSec = (performance.now() - t0) / 1000
    var text = (result.text || '').trim()
    if (text) {
      // 句级声纹：整句提嵌入 → 增量聚类归属；短句/异常沿用上句标签
      var sp = classifySpeaker(audio)
      var speaker = sp ? sp.speaker : lastSpeaker
      var similarity = sp ? sp.similarity : 0
      post({
        type: 'sentence',
        speaker: speaker,
        startSec: startSec,
        endSec: startSec + audio.length / SAMPLE_RATE,
        text: text,
        similarity: similarity,
      })
    }
    console.info('[sherpa] 句推理 ' + inferSec.toFixed(1) + 's（' + (audio.length / SAMPLE_RATE).toFixed(1) + 's 音频）')
    if (!inferReported) {
      inferReported = true
      post({ type: 'infer', sec: inferSec, audioSec: audio.length / SAMPLE_RATE, first: true })
    }
  } catch (err) {
    postStatus('error', '句推理异常：' + (err && err.message ? err.message : String(err)))
  } finally {
    busy = false
  }
}
