import { md5 } from './md5'

/**
 * 分類 → 一個代表色（`.chip` 的 `--marker`：底色 / 框線 / 文字都從它 color-mix
 * 出來）。色相取自 md5(分類)，跟桌面版 `file_search_app/colors.py` 的
 * `hash_hsl_hex` 與便利貼標籤同一套公式——同一個分類在桌面清單、files-web、
 * 便利貼看到的都是同一個色相。文字色由 CSS 用 `--ink`（跟主題走）調出來，
 * 不在這裡算死，不然深色模式下深字疊深晶片會看不到。
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

/** 分類名稱 → `.chip` 的 `--marker`（#rrggbb）。 */
export function categoryColor(category: string): string {
  const hue = Number(BigInt('0x' + md5(category)) % 360n) / 360
  return hslHex(hue, 0.55, 0.55)
}
