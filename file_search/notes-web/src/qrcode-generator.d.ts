/**
 * `qrcode-generator`（Kazuhiko Arase，MIT）自帶的型別是 `export =` 形式，在本專案的
 * `verbatimModuleSyntax` 下 default import 會抱怨。這裡給一份最小 ESM 宣告，只涵蓋
 * `src/lib/qr.ts` 實際用到的部分；執行期由 Vite/esbuild 處理 CJS→ESM interop。
 */
declare module 'qrcode-generator' {
  interface QRCode {
    addData(data: string): void
    make(): void
    getModuleCount(): number
    isDark(row: number, col: number): boolean
    createSvgTag(opts?: {
      cellSize?: number
      margin?: number
      scalable?: boolean
      title?: string
    }): string
    createDataURL(cellSize?: number, margin?: number): string
  }
  type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'
  /** typeNumber 0 = 自動選最小容納得下的版本。 */
  function qrcode(typeNumber: number, errorCorrectionLevel: ErrorCorrectionLevel): QRCode
  export default qrcode
}
