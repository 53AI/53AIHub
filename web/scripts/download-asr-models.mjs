/**
 * 下载端侧 ASR 模型到 public/models/（同源自托管，规避 hf-mirror CORS / huggingface 网络问题）。
 *
 * 用法：node scripts/download-asr-models.mjs [--source https://huggingface.co]
 * 产物：apps/front-react/public/models/<repo>/...（gitignore 不入库；构建时随 public 拷入 dist）
 *
 * 服务端 Node 下载无 CORS 限制，源默认 hf-mirror。
 */

import { createWriteStream, existsSync, mkdirSync, statSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_MODELS = join(__dirname, '..', 'apps', 'front-react', 'public', 'models')

const source = process.argv.includes('--source')
  ? process.argv[process.argv.indexOf('--source') + 1]
  : 'https://hf-mirror.com'

/**
 * zipformer zh-14M（弱机降级档，安卓端 KM-Record 同款）：流式 transducer，
 * 14M 参数边说边出，24MB 下载。SHA256 抄安卓端 AsrModelSpec（单一来源）。
 */
const SHERPA_DIR = join(PUBLIC_MODELS, 'sherpa')
const ZIPFORMER_REPO = 'csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23'
const ZIPFORMER_FILES = [
  { file: 'encoder-epoch-99-avg-1.int8.onnx', size: 21621684, sha256: '1c556ea57cec304e55ec4b72e52c1cc098bb01476ed7d90f3de939fe126487b1' },
  { file: 'decoder-epoch-99-avg-1.int8.onnx', size: 1888682, sha256: '22f123bb8cba9b38974b3df18a3f45e7081f4985ebb2e075d9f21f618c468bbf' },
  { file: 'joiner-epoch-99-avg-1.int8.onnx', size: 1795562, sha256: 'a7cf9d82757bdcf786059454495a9ca95e4bd7347f72473fc08d794475c36169' },
  // tokens.txt 非 LFS 小文件，HF 不提供 sha256，用长度校验（安卓端同策略）
  { file: 'tokens.txt', size: 48697, sha256: null },
]

/**
 * paraformer-large（cpu-strong 档，非流式）：FunASR 中文质量档，232MB int8。
 * sherpa-onnx 官方导出（csukuangfj/sherpa-onnx-paraformer-zh-2023-09-14）。
 */
const PARAFORMER_DIR = join(PUBLIC_MODELS, 'paraformer')
const PARAFORMER_REPO = 'csukuangfj/sherpa-onnx-paraformer-zh-2023-09-14'
const PARAFORMER_FILES = [
  { file: 'model.int8.onnx', size: 243371218, sha256: null },
  { file: 'tokens.txt', size: 75756, sha256: null },
]

/**
 * SenseVoice-small（备选档，非流式）：另一会话验证 RTF 0.153、质量≈whisper-small、
 * CTC 零幻觉。csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17。
 */
const SENSEVOICE_DIR = join(PUBLIC_MODELS, 'sensevoice')
const SENSEVOICE_REPO = 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'
const SENSEVOICE_FILES = [
  { file: 'model.int8.onnx', size: null, sha256: null },
  { file: 'tokens.txt', size: null, sha256: null },
]

/** sherpa 引擎（自建 km-web wasm + v1.12.15 配套 JS 封装）：scripts/assets/sherpa-engine/ 入库。
 *  自建原因：官方变体均未编译 SpeakerEmbeddingExtractor/Manager（说话人分离核心）。
 *  重编：tmp/sherpa-onnx-1.12.15（源码+补丁），build-wasm-simd-km-web.sh，emsdk 3.1.53。 */
const MEETINGPLUGIN_SHERPA = join(__dirname, 'assets', 'sherpa-engine')
const SHERPA_ENGINE_FILES = ['sherpa-onnx-wasm-web.js', 'sherpa-onnx-wasm-web.wasm', 'sherpa-onnx-asr.js', 'sherpa-onnx-vad.js']

/** 下载一组模型文件到指定目录（存在且大小匹配则跳过；size null 仅验存在） */
async function downloadModelGroup(groupName, dir, repo, files) {
  console.log(`\n${groupName}:`)
  mkdirSync(dir, { recursive: true })
  for (const f of files) {
    const dest = join(dir, f.file)
    if (existsSync(dest) && (f.size === null || statSync(dest).size === f.size)) {
      console.log(`已存在，跳过: ${f.file}`)
      continue
    }
    const url = `${source}/${repo}/resolve/main/${f.file}`
    console.log(`下载: ${url}`)
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) {
      failed++
      console.error(`  ✗ ${res.status} ${f.file}`)
      continue
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
    const size = statSync(dest).size
    if (f.size !== null && size !== f.size) {
      failed++
      console.error(`  ✗ ${f.file} 长度不符（${size} ≠ ${f.size}），删除重下`)
      rmSync(dest)
      continue
    }
    if (f.sha256) {
      const hash = createHash('sha256').update(readFileSync(dest)).digest('hex')
      if (hash !== f.sha256) {
        failed++
        console.error(`  ✗ ${f.file} sha256 不符，删除重下`)
        rmSync(dest)
        continue
      }
    }
    console.log(`  ✓ ${(size / 1024 / 1024).toFixed(1)} MB`)
  }
}

/** HF 上不存在、需本地生成的文件（内容 → 相对路径） */
const LOCAL_FILES = []

let failed = 0
for (const f of LOCAL_FILES) {
  const dest = join(PUBLIC_MODELS, f.path)
  if (existsSync(dest)) {
    console.log(`已存在，跳过: ${f.path}`)
    continue
  }
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, f.content)
  console.log(`✓ 本地生成: ${f.path}`)
}

// ============ sherpa 系模型（zipformer / paraformer） ============
await downloadModelGroup('zipformer zh-14M（弱机档，流式，24MB）', SHERPA_DIR, ZIPFORMER_REPO, ZIPFORMER_FILES)
await downloadModelGroup('paraformer-large（cpu-strong 档，非流式，232MB）', PARAFORMER_DIR, PARAFORMER_REPO, PARAFORMER_FILES)
// SenseVoice-small（备选档，未接线）：暂不下载——266MB 白拷白传（dist 体积/部署耗时
// 直接受损）。worker MODEL_CONFIGS 配置保留，启用时取消下行注释即可。
// await downloadModelGroup('SenseVoice-small（备选档，非流式）', SENSEVOICE_DIR, SENSEVOICE_REPO, SENSEVOICE_FILES)

// sherpa 配套小资产（scripts/assets/ 入库，免 python onnx 依赖）：
//   silero-vad-sherpa.onnx（644KB）：官方 v1.12.15 配套版。注意不能用
//   onnx-community/silero-vad（2.2MB 新版转换）——与 sherpa-onnx 的
//   onnxruntime 1.17.1 不兼容（session 创建挂死，实测）；whisper 档
//   （transformers.js）继续用 onnx-community 版，两档各自配套。
//   wespeaker-cnceleb-resnet34-LM-meta.onnx（26.5MB）：已注入 sherpa-onnx
//   要求的 metadata（sample_rate/output_dim 等，官方 add_meta_data.py 同款）。
const SHERPA_ASSETS = join(__dirname, 'assets')
// 目标目录与下载侧对齐（sensevoice 已砍：未接线不下载，资产也不复制）
const MODEL_DIRS = [SHERPA_DIR, PARAFORMER_DIR]
for (const dir of MODEL_DIRS) {
  const sileroDest = join(dir, 'silero-vad.onnx')
  if (!existsSync(sileroDest)) {
    copyFileSync(join(SHERPA_ASSETS, 'silero-vad-sherpa.onnx'), sileroDest)
    console.log(`✓ silero-VAD 复制到 ${dirname(sileroDest).split(/[\\/]/).pop()}/`)
  }
  const wespeakerDest = join(dir, 'wespeaker.onnx')
  if (!existsSync(wespeakerDest)) {
    copyFileSync(join(SHERPA_ASSETS, 'wespeaker-cnceleb-resnet34-LM-meta.onnx'), wespeakerDest)
    console.log(`✓ wespeaker 声纹复制到 ${dirname(wespeakerDest).split(/[\\/]/).pop()}/`)
  }
}

// 引擎复制到三个模型目录（自建 km-web 版，worker 的 importScripts
// 以各自模型目录为 base 加载引擎，locateFile 同目录解析 wasm）
for (const file of SHERPA_ENGINE_FILES) {
  const src = join(MEETINGPLUGIN_SHERPA, file)
  if (!existsSync(src)) {
    failed++
    console.error(`  ✗ 引擎源不存在: ${src}`)
    continue
  }
  for (const dir of MODEL_DIRS) {
    const dest = join(dir, file)
    copyFileSync(src, dest)
  }
  console.log(`✓ 引擎复制到 ${MODEL_DIRS.length} 目录: ${file}（${(statSync(src).size / 1024 / 1024).toFixed(1)} MB）`)
}

console.log(failed === 0 ? '\n全部完成。' : `\n${failed} 个文件失败，重跑本脚本可断点续传。`)
