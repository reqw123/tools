import { api } from './api'

/**
 * 匯出全部便利貼成可攜 JSON 並觸發瀏覽器下載——跟桌面版「💾 匯出資料」是
 * 同一種格式，可以互通。跟 `exportHtml.ts` 的 `downloadStickyNotesHtml()`
 * 是同一套「fetch/組字串 → Blob → 隱藏 <a> 點一下 → 收掉」手法，差別只在
 * 內容是問後端要來的（後端才拿得到完整清單，不受目前畫面篩選影響）。
 */
export async function downloadNotesJson(): Promise<void> {
  const content = await api.exportJson()
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  a.href = url
  a.download = `便利貼備份_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
