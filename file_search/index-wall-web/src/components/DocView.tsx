import { useMemo } from 'react'
import { marked } from 'marked'

/**
 * 「原文檢視」——把整份 .md（前言 + 表格）render 成一頁。
 * 內容是本機可信檔案，直接 render，不做 DOM sanitize。
 */
export function DocView({ markdown }: { markdown: string }) {
  const html = useMemo(
    () => (marked.parse(markdown, { async: false, gfm: true }) as string),
    [markdown],
  )
  return <article className="doc" dangerouslySetInnerHTML={{ __html: html }} />
}
