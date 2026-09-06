import type { CSSProperties } from 'react'
import { md5 } from './md5'

/** 無分類的中性灰——對應 file_search_app config 的 STICKY_NEUTRAL_COLOR。 */
export const NEUTRAL = '#e5e7eb'

/** 卡片文字色——對應 STICKY_CARD_TEXT_COLOR。 */
export const PAPER_INK = '#1f2937'

const SAT = 0.55 // STICKY_TAG_SATURATION
const LIGHT = 0.82 // STICKY_TAG_LIGHTNESS

function hue2rgb(m1: number, m2: number, h: number): number {
  h = ((h % 1) + 1) % 1
  if (h < 1 / 6) return m1 + (m2 - m1) * h * 6
  if (h < 1 / 2) return m2
  if (h < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - h) * 6
  return m1
}

/** colorsys.hls_to_rgb 的移植（引數順序 H, L, S）。回傳 0~1 的 [r, g, b]。 */
function hlsToRgb(h: number, l: number, s: number): [number, number, number] {
  if (s === 0) return [l, l, l]
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s
  const m1 = 2 * l - m2
  return [hue2rgb(m1, m2, h + 1 / 3), hue2rgb(m1, m2, h), hue2rgb(m1, m2, h - 1 / 3)]
}

const toHex = (n: number) => Math.trunc(n * 255).toString(16).padStart(2, '0')

/**
 * 對應 sticky_note_service.color_for_tag()：
 * 空字串 → 中性灰；否則先查 `overrides`（使用者在「⏰ 提醒設定」旁邊自訂過
 * 的顏色，來自 useTagColors()）有沒有這個標籤，有就直接用；沒有才走
 * md5(tag) 當成 128-bit 整數 % 360 取色環角度，再用固定的飽和度/亮度
 * （55% / 82%）轉成 HSL → RGB。整數截斷（不四捨五入），跟 Python 的
 * int(x*255) 一致。
 */
export function colorForTag(tag: string, overrides?: Record<string, string>): string {
  if (!tag) return NEUTRAL
  const override = overrides?.[tag]
  if (override) return override
  const hue = Number(BigInt('0x' + md5(tag)) % 360n) / 360
  const [r, g, b] = hlsToRgb(hue, LIGHT, SAT)
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/** 往黑色混合 factor（0~1）——對應 ui/styles.py 的 darken()。 */
export function darken(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - factor))
  return `#${[ch(16), ch(8), ch(0)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** 補上 8 位十六進位透明度。 */
export function alpha(hex: string, a: number): string {
  return hex + Math.round(a * 255).toString(16).padStart(2, '0')
}

// 桌面版 config 的三個 darken 係數
export const FOLD_DARKEN = 0.2 // STICKY_CARD_FOLD_DARKEN
export const TAPE_DARKEN = 0.12 // STICKY_CARD_BORDER_DARKEN

/** 便利貼一組衍生色 + 傾斜角 + 進場序號，塞進 CSS 自訂屬性用。 */
export function paperVars(
  tag: string,
  rot = 0,
  index?: number,
  overrides?: Record<string, string>,
): CSSProperties {
  const face = colorForTag(tag, overrides)
  const vars: Record<string, string | number> = {
    '--face': face,
    '--fold': darken(face, FOLD_DARKEN),
    '--tape': darken(face, TAPE_DARKEN),
    '--halo': alpha(face, 0.52),
    '--rot': `${rot}deg`,
    '--tape-rot': `${-rot * 1.5}deg`,
  }
  if (index !== undefined) vars['--i'] = index
  return vars as CSSProperties
}
