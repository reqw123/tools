import { useMemo, useState } from 'react'
import { marked } from 'marked'
import { ChevronRight, Info } from 'lucide-react'

/**
 * 索引集前言（表格以外的 markdown）。預設折疊——每份索引的前言幾乎都是
 * 同一段格式規定說明。內容來自本機可信檔案，直接 render，不做 DOM sanitize。
 */
export function Preamble({ markdown }: { markdown: string }) {
  const [open, setOpen] = useState(false)
  const html = useMemo(
    () => (markdown ? (marked.parse(markdown, { async: false }) as string) : ''),
    [markdown],
  )
  if (!markdown) return null

  return (
    <section className={`preamble${open ? ' open' : ''}`}>
      <button className="preamble-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronRight size={14} className="chev" aria-hidden />
        <Info size={14} aria-hidden />
        這份索引的格式說明
      </button>
      {open && (
        <div className="preamble-body" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </section>
  )
}
