import { useLayoutEffect, useMemo, useRef } from 'react'
import { marked } from 'marked'

/** 把 el 底下所有文字節點裡符合 needle（不分大小寫）的片段包成
 *  `<mark data-find>`。只碰文字節點，不動既有結構。 */
function highlight(el: HTMLElement, needle: string): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    if (t.data && t.data.toLowerCase().includes(needle)) targets.push(t)
  }
  for (const node of targets) {
    const text = node.data
    const lower = text.toLowerCase()
    const frag = document.createDocumentFragment()
    let i = 0
    for (;;) {
      const at = lower.indexOf(needle, i)
      if (at === -1) break
      if (at > i) frag.append(text.slice(i, at))
      const mark = document.createElement('mark')
      mark.dataset.find = ''
      mark.textContent = text.slice(at, at + needle.length)
      frag.append(mark)
      i = at + needle.length
    }
    if (i < text.length) frag.append(text.slice(i))
    node.replaceWith(frag)
  }
}

function resetView(root: HTMLElement): void {
  for (const m of root.querySelectorAll('mark[data-find]')) {
    m.replaceWith(document.createTextNode(m.textContent ?? ''))
  }
  root.normalize()
  for (const el of root.querySelectorAll('.dv-hide')) el.classList.remove('dv-hide')
}

/**
 * 「文件檢視」——把整份索引集的 .md（前言 + 表格）當一份文件 render 成一頁。
 * 有輸入搜尋字時**只留下符合的表格列**（其餘列、以及前言等非項目內容都收起來），
 * 並把符合的文字高亮；清空搜尋字就恢復整份文件。內容是本機可信檔案，直接
 * render，不做 DOM sanitize。
 */
export function DocView({ markdown, query }: { markdown: string; query: string }) {
  const html = useMemo(
    () => marked.parse(markdown, { async: false, gfm: true }) as string,
    [markdown],
  )
  const ref = useRef<HTMLElement>(null)
  const q = query.trim().toLowerCase()

  const hits = useMemo(() => {
    if (!q) return 0
    const el = document.createElement('div')
    el.innerHTML = html
    let c = 0
    for (const tr of el.querySelectorAll('tbody tr')) {
      if ((tr.textContent ?? '').toLowerCase().includes(q)) c += 1
    }
    return c
  }, [html, q])

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    resetView(root)
    if (!q) return
    // 非表格的頂層區塊（前言 blockquote、標題、分隔線…）不是「項目」，搜尋時收起來。
    for (const child of Array.from(root.children)) {
      if (child.tagName !== 'TABLE') child.classList.add('dv-hide')
    }
    // 每張表：不符合的資料列收起來，整張表都沒有符合的列就連表一起收。
    for (const table of root.querySelectorAll('table')) {
      let anyVisible = false
      for (const tr of table.querySelectorAll('tbody tr')) {
        if ((tr.textContent ?? '').toLowerCase().includes(q)) {
          anyVisible = true
          highlight(tr as HTMLElement, q)
        } else {
          tr.classList.add('dv-hide')
        }
      }
      if (!anyVisible) table.classList.add('dv-hide')
    }
    return () => {
      if (root.isConnected) resetView(root)
    }
  }, [html, q])

  return (
    <div className="doc-wrap">
      {q && (
        <div className="doc-find mono" role="status">
          {hits ? `符合 ${hits} 筆項目` : '沒有符合的項目'}
        </div>
      )}
      <article
        className={`doc${q ? ' dv-filtering' : ''}`}
        ref={ref}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
