import qrcode from 'qrcode-generator'

/**
 * 把文字（這裡是公網分享網址）編成一張 QR，回傳可直接丟進 `<img src>` 的
 * `data:image/svg+xml` URI。純前端、離線可跑，不打任何外部 QR 服務（不然等於
 * 把「私人牆的網址」送給第三方）。
 *
 * 用 `<img>` + data URI 而非把 `<svg>` 直接塞進 DOM：後者疊在對話框的
 * `backdrop-filter` 遮罩上、又要 `height:auto` 追比例時，某些情況下會讓 Chrome
 * 的合成器卡住。`<img>` 一張點陣／向量圖，畫起來便宜且穩定。
 *
 * 錯誤更正等級 M（~15%）＋ 自動版本；網址通常 30~60 字，綽綽有餘。
 */
export function qrDataUri(text: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const svg = qr.createSvgTag({ cellSize: 8, margin: 2 })
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
