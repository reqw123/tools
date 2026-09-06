/**
 * 匯出目前索引集的原始 .md 內容並觸發瀏覽器下載——內容已經在 `useIndex()`
 * 抓過（`payload.raw`），不需要另外呼叫後端，直接組 Blob 存檔。跟桌面版
 * 「📤 匯出索引集...」是同一件事：索引集本來就是一份 .md，匯出就是把原始
 * 內容存到別的地方。
 */
export function downloadIndexMarkdown(name: string, raw: string): void {
  const blob = new Blob([raw], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name.toLowerCase().endsWith('.md') ? name : `${name}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
