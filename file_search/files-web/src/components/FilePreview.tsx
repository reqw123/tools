import { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import { api, type PreviewResult } from '../lib/api'
import { humanSize, type Kind } from '../lib/format'

const MESSAGE: Record<string, string> = {
  unsupported: '這個檔案類型不支援在網頁上預覽，請用「開啟檔案」。',
  missing: '磁碟上找不到這個檔案。',
  toobig: '檔案太大，不在網頁上預覽。',
}

/** 被索引檔案本身的內容預覽：圖片／影音／PDF 直接串流，純文字／markdown 抓內容 render。 */
export function FilePreview({ path, kind }: { path: string; kind: Kind }) {
  const url = api.fileUrl(path)

  if (kind === 'image') {
    return (
      <div className="preview">
        <img className="preview-media" src={url} alt={path} loading="lazy" />
      </div>
    )
  }
  if (kind === 'video') {
    return (
      <div className="preview">
        <video className="preview-media" src={url} controls preload="metadata" />
      </div>
    )
  }
  if (kind === 'audio') {
    return (
      <div className="preview preview-audio">
        <audio src={url} controls preload="metadata" />
      </div>
    )
  }
  if (kind === 'pdf') {
    return (
      <div className="preview">
        <iframe className="preview-pdf" src={url} title={path} />
      </div>
    )
  }
  return <TextPreview path={path} />
}

function TextPreview({ path }: { path: string }) {
  const [res, setRes] = useState<PreviewResult | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    api.preview(path).then(
      (r) => {
        if (alive) setRes(r)
      },
      (e: Error) => {
        if (alive) setErr(e.message || '讀取失敗')
      },
    )
    return () => {
      alive = false
    }
  }, [path])

  const md = useMemo(() => {
    if (res?.kind === 'markdown' && res.text)
      return marked.parse(res.text, { async: false, gfm: true }) as string
    return ''
  }, [res])

  if (err) return <p className="preview-msg err">{err}</p>
  if (!res) return <p className="preview-msg">讀取中…</p>
  if (res.kind === 'unsupported' || res.kind === 'missing' || res.kind === 'toobig') {
    return (
      <p className="preview-msg">
        {MESSAGE[res.kind]}
        {res.kind === 'toobig' && res.bytes !== undefined && `（${humanSize(res.bytes)}）`}
      </p>
    )
  }

  return (
    <div className="preview">
      {res.kind === 'markdown' ? (
        <div className="doc mini" dangerouslySetInnerHTML={{ __html: md }} />
      ) : (
        <pre className="preview-text">{res.text}</pre>
      )}
      {res.truncated && (
        <p className="preview-msg">內容過長，只顯示前面一段。完整內容請「開啟檔案」。</p>
      )}
    </div>
  )
}
