/**
 * 生成 SafeImage 兜底用的中性图标 (PNG, 透明底, 单色)。
 *
 * 为什么自己画：shared-public 里现有的 tools/builtin.png（纯青绿实心方块）不能当兜底图，
 * 而仓里没有 svg 栅格化工具（无 sharp / rsvg / ImageMagick）。
 * 这里用 SDF + 抗锯齿直接编码 PNG，零依赖。
 *
 * 用法：node scripts/gen-fallback-icons.mjs
 * 输出：packages/shared-public/images/default_tool.png
 *
 * 换颜色/尺寸改下面的 SIZE / COLOR 常量重跑即可。
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SIZE = 256
const COLOR = [0x9a, 0xa4, 0xb2] // #9AA4B2 中灰，亮/暗背景都可辨（与 default_placeholder.png 一致）
const OUT_DIR = resolve('packages/shared-public/images')

// ---------- SDF 基础 ----------
const len = (x, y) => Math.hypot(x, y)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

function sdRoundRect(px, py, hw, hh, r) {
  const qx = Math.abs(px) - hw + r
  const qy = Math.abs(py) - hh + r
  return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

const sdCircle = (px, py, r) => len(px, py) - r

// ---------- 图形 ----------
/** 齿轮：中心盘 ∪ 8 个齿，再挖中心孔 */
function sdGear(px, py) {
  const body = sdCircle(px, py, 68)
  let teeth = Infinity
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    const cos = Math.cos(-a)
    const sin = Math.sin(-a)
    // 把点旋到齿的局部坐标（齿从 r=44 伸出到 r=92）
    const rx = px * cos - py * sin
    const ry = px * sin + py * cos
    const d = sdRoundRect(rx, ry - 66, 12, 24, 6)
    teeth = Math.min(teeth, d)
  }
  const solid = Math.min(body, teeth)
  const hole = sdCircle(px, py, 24)
  return Math.max(solid, -hole)
}

/** 内容过少时的浅色底? 保持透明——与 default_placeholder.png 一致 */
// skill 用官方默认 logo（images/skill/logo.png），不需要自绘
const SHAPES = {
  'default_tool.png': sdGear,
}

// ---------- 光栅化 + PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([lenBuf, body, crc])
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = size * 4
  const raw = Buffer.alloc(size * (stride + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT_DIR, { recursive: true })
const half = SIZE / 2

for (const [file, sdf] of Object.entries(SHAPES)) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = sdf(x + 0.5 - half, y + 0.5 - half)
      const a = clamp(0.5 - d, 0, 1) // 1px 过渡带做抗锯齿
      const i = (y * SIZE + x) * 4
      rgba[i] = COLOR[0]
      rgba[i + 1] = COLOR[1]
      rgba[i + 2] = COLOR[2]
      rgba[i + 3] = Math.round(a * 255)
    }
  }
  const out = resolve(OUT_DIR, file)
  const png = encodePng(rgba, SIZE)
  writeFileSync(out, png)
  console.log('written', out, `${(png.length / 1024).toFixed(1)}KB`)
}
