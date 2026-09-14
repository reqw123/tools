import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, QrCode } from 'lucide-react'
import { useShareInfo } from '../hooks/useShareInfo'
import { qrDataUri } from '../lib/qr'
import { scrimClose } from '../lib/scrimClose'

/**
 * 工具列上的「分享公網連結」鈕——只有伺服器有開 ngrok 公網通道時才出現。
 * 搬自 notes-web/src/components/ShareLinkButton.tsx，機制與版面完全相同，
 * 只換了文案（便利貼牆→索引牆）。純顯示既有的網址，不改任何狀態。
 */
export function ShareLinkButton() {
  const { publicUrl } = useShareInfo()
  const [open, setOpen] = useState(false)
  if (!publicUrl) return null
  return (
    <>
      <button
        className="toggle"
        onClick={() => setOpen(true)}
        title="分享這面索引牆的公網連結（給不在同個 Wi-Fi 的人）"
        aria-label="分享公網連結"
      >
        <QrCode size={15} strokeWidth={2.2} aria-hidden />
        <span>分享</span>
      </button>
      {open && <ShareLinkDialog url={publicUrl} onClose={() => setOpen(false)} />}
    </>
  )
}

function ShareLinkDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const qrSrc = useMemo(() => {
    try {
      return qrDataUri(url)
    } catch {
      return ''
    }
  }, [url])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const copy = () => {
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      },
      () => {},
    )
  }

  // 這顆鈕住在工具列裡，跟 notes-web 一樣可能被 backdrop-filter/transform
  // 影響 position:fixed 的定位基準，用 portal 掛到 <body> 底下保險。
  return createPortal(
    <div className="scrim" {...scrimClose(onClose)}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="分享公網連結"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>分享這面索引牆</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="sub">把這個網址給任何人（不用同一個 Wi-Fi）。他們要輸入共用密碼才進得來。</p>

          {qrSrc && (
            <p style={{ textAlign: 'center' }}>
              <img src={qrSrc} alt="" width={200} height={200} />
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              style={{ flex: 1, fontFamily: 'monospace' }}
            />
            <button className="btn" onClick={copy}>
              {copied ? (
                <>
                  <Check size={14} strokeWidth={2.4} aria-hidden /> 已複製
                </>
              ) : (
                <>
                  <Copy size={14} strokeWidth={2.2} aria-hidden /> 複製
                </>
              )}
            </button>
          </div>

          <p className="sub">
            免費 ngrok：每台裝置第一次打開會看到一頁 ngrok 提醒，按「Visit Site」就進得來。
            關掉啟動視窗後這個網址就失效；下次啟動會換一個新的。
          </p>
        </div>

        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
