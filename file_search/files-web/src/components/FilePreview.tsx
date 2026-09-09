import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
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

const ZOOM_KEY = 'iw-preview-zoom'
const ZOOM_MIN = 0.6
const ZOOM_MAX = 2.6
const ZOOM_STEP = 0.1

/**
 * 文字／markdown 預覽的字級縮放——記在 localStorage（同一個 session 的其他
 * 預覽也跟著），滑鼠移到預覽框上（或焦點在裡面）時攔 Ctrl/⌘ + `+` / `-` / `0`
 * 與 Ctrl/⌘ + 滾輪，只縮這個框裡的字、不動整頁瀏覽器縮放。
 */
function usePreviewZoom() {
  const [zoom, setZoom] = useState(() => {
    try {
      const v = Number(localStorage.getItem(ZOOM_KEY))
      return v >= ZOOM_MIN && v <= ZOOM_MAX ? v : 1
    } catch {
      return 1
    }
  })
  const boxRef = useRef<HTMLDivElement>(null)
  const hover = useRef(false)
  // 讓 effect 裡的 handler 讀得到最新 zoom，又不用因為 zoom 變就重綁 listener。
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  const set = (next: number) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 20) / 20))
    setZoom(clamped)
    try {
      localStorage.setItem(ZOOM_KEY, String(clamped))
    } catch {
      /* private mode */
    }
  }
  const bump = (dir: 1 | -1) => set(zoomRef.current + dir * ZOOM_STEP)
  const reset = () => set(1)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const active = () => hover.current || box.contains(document.activeElement)

    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || !active()) return
      if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
        e.preventDefault()
        set(zoomRef.current + ZOOM_STEP)
      } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
        e.preventDefault()
        set(zoomRef.current - ZOOM_STEP)
      } else if (e.key === '0' || e.code === 'Numpad0') {
        e.preventDefault()
        set(1)
      }
    }
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      set(zoomRef.current + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))
    }
    window.addEventListener('keydown', onKey)
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      box.removeEventListener('wheel', onWheel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const boxProps = {
    ref: boxRef,
    tabIndex: 0,
    onMouseEnter: () => {
      hover.current = true
    },
    onMouseLeave: () => {
      hover.current = false
    },
    style: { '--preview-zoom': String(zoom) } as CSSProperties,
  }
  return { zoom, boxProps, bump, reset }
}

function TextPreview({ path }: { path: string }) {
  const [res, setRes] = useState<PreviewResult | null>(null)
  const [err, setErr] = useState('')
  const { zoom, boxProps, bump, reset } = usePreviewZoom()

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

  const showText =
    !!res && (res.kind === 'markdown' || res.kind === 'text')

  return (
    // 容器一律 render（就算還在讀取／出錯）——這樣 boxProps.ref 從第一次
    // render 就掛上，usePreviewZoom 的 listener 才綁得到。
    <div className="preview" {...boxProps}>
      {err ? (
        <p className="preview-msg err">{err}</p>
      ) : !res ? (
        <p className="preview-msg">讀取中…</p>
      ) : !showText ? (
        <p className="preview-msg">
          {MESSAGE[res.kind]}
          {res.kind === 'toobig' && res.bytes !== undefined && `（${humanSize(res.bytes)}）`}
        </p>
      ) : (
        <>
          <div className="preview-zoom mono" role="group" aria-label="字級">
            <button type="button" onClick={() => bump(-1)} aria-label="縮小字級" title="縮小（Ctrl −）">
              <Minus size={12} aria-hidden />
            </button>
            <button
              type="button"
              onClick={reset}
              aria-label="還原字級為 100%"
              title="還原（Ctrl 0）"
              disabled={zoom === 1}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={() => bump(1)} aria-label="放大字級" title="放大（Ctrl +）">
              <Plus size={12} aria-hidden />
            </button>
            <span className="preview-zoom-hint">Ctrl +/−/0</span>
          </div>
          {res.kind === 'markdown' ? (
            <div className="doc mini" dangerouslySetInnerHTML={{ __html: md }} />
          ) : (
            <pre className="preview-text">{res.text}</pre>
          )}
          {res.truncated && (
            <p className="preview-msg">內容過長，只顯示前面一段。完整內容請「開啟檔案」。</p>
          )}
        </>
      )}
    </div>
  )
}
