import { md5 } from './md5'

/**
 * 分類 → 一組顏色，塞進 `.chip` 的 CSS 自訂屬性（`--marker` 底/框、
 * `--marker-ink` 文字）。色相取自 md5(分類)，跟桌面版
 * `file_search_app/colors.py` 的 `hash_hsl_hex` 與便利貼標籤同一套公式——
 * 同一個分類在桌面清單、files-web、便利貼看到的都是同一個色相。
 */

function hue2rgb(m1: number, m2: number, h: number): number {
  h = ((h % 1) + 1) % 1
  if (h < 1 / 6) return m1 + (m2 - m1) * h * 6
  if (h < 1 / 2) return m2
  if (h < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - h) * 6
  return m1
}

const toHex = (n: number) => Math.trunc(n * 255).toString(16).padStart(2, '0')

/** colorsys.hls_to_rgb 的移植（引數順序 H, L, S）→ #rrggbb，整數截斷、跟
 *  Python 的 int(x*255) 一致。 */
function hslHex(h: number, l: number, s: number): string {
  if (s === 0) return `#${toHex(l)}${toHex(l)}${toHex(l)}`
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s
  const m1 = 2 * l - m2
  return (
    `#${toHex(hue2rgb(m1, m2, h + 1 / 3))}` +
    `${toHex(hue2rgb(m1, m2, h))}${toHex(hue2rgb(m1, m2, h - 1 / 3))}`
  )
}

export interface CategoryColors {
  /** `.chip` 的 `--marker`——底色 / 框線的來源（CSS 再各自 color-mix 淡化）。 */
  marker: string
  /** `.chip` 的 `--marker-ink`——晶片上的文字色（深、讀得清楚）。 */
  ink: string
}

export function categoryColors(category: string): CategoryColors {
  const hue = Number(BigInt('0x' + md5(category)) % 360n) / 360
  return {
    marker: hslHex(hue, 0.55, 0.55),
    ink: hslHex(hue, 0.28, 0.6),
  }
}
