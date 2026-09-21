import type { ReactNode } from 'react'

const URL_RE = /https?:\/\/[^\s<>"'）】」』]+/g
// 網址尾端常黏著中文／英文標點收尾（句號、頓號、括號…），不是網址本身的一部分，切掉再顯示。
const TRAILING_PUNCT_RE = /[.,;:!?，。、；：！？）】」』"'\]]+$/

// Mac 是 Cmd 不是 Ctrl——提示文字跟著平台換，不然 Mac 使用者照著按 Ctrl 沒反應。
const HINT_TEXT =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
    ? '⌘+左鍵點擊開啟網頁'
    : 'Ctrl+左鍵點擊開啟網頁'

/** 把純文字裡的網址轉成可點的連結——一般點擊沿用原本行為（冒泡給外層開便利貼），
 *  只有 Ctrl/Cmd+左鍵才真的開新分頁，避免跟「點便利貼開啟」的既有手勢打架。 */
export function linkifyText(text: string): ReactNode {
  if (!text || !URL_RE.test(text)) return text
  URL_RE.lastIndex = 0

  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(URL_RE)) {
    const idx = m.index ?? 0
    if (idx > last) nodes.push(text.slice(last, idx))

    const raw = m[0]
    const trailingMatch = raw.match(TRAILING_PUNCT_RE)
    const url = trailingMatch ? raw.slice(0, raw.length - trailingMatch[0].length) : raw
    const trailing = trailingMatch ? trailingMatch[0] : ''

    nodes.push(
      <a
        key={key++}
        href={url}
        className="note-link"
        aria-label={`${url}（${HINT_TEXT}）`}
        data-tip={HINT_TEXT}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          // 一律擋掉 <a> 的預設導向——沒按 Ctrl/Cmd 時讓 click 冒泡給外層（開便利貼），
          // 按了才自己開新分頁，兩者都不能讓瀏覽器自己導頁（會整頁跳走或跟外層手勢衝突）。
          e.preventDefault()
          if (e.ctrlKey || e.metaKey) {
            e.stopPropagation()
            // 桌面牆（wallpaper-app）是 Electron 自己的 BrowserWindow，session
            // 跟使用者平常用的瀏覽器是分開的、沒有登入狀態——直接 window.open()
            // 會在裡面開一個沒登入的分頁，某些網站（例如需要登入才能播放的
            // 影片）因此打不開。有 desktopWall 可用時改交給系統預設瀏覽器開。
            if (window.desktopWall?.openExternal) window.desktopWall.openExternal(url)
            else window.open(url, '_blank', 'noopener,noreferrer')
          }
        }}
      >
        {url}
      </a>,
      trailing,
    )
    last = idx + raw.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}
