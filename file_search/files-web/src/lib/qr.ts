import qrcode from 'qrcode-generator'

/**
 * 把文字（這裡是公網分享網址）編成一張 QR，回傳可直接丟進 `<img src>` 的
 * `data:image/svg+xml` URI。搬自 notes-web/src/lib/qr.ts，純前端、離線可跑，
 * 不打任何外部 QR 服務。錯誤更正等級 M（~15%）＋自動版本。
 */
export function qrDataUri(text: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const svg = qr.createSvgTag({ cellSize: 8, margin: 2 })
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
