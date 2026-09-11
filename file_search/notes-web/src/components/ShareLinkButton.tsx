import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, QrCode } from 'lucide-react'
import { useShareInfo } from '../hooks/useShareInfo'
import { qrDataUri } from '../lib/qr'
import { scrimClose } from '../lib/scrimClose'

/**
 * 工具列上的「分享公網連結」鈕——只有伺服器有開 ngrok 公網通道
 * （`/api/share-info` 回了 `publicUrl`）時才出現。點開跳一張小卡：網址、
 * 複製鈕、QR 碼、以及「第一次要按 Visit Site」的提醒。
 *
 * 純顯示既有的網址，不改任何狀態；隧道由啟動器 `scripts/share-serve.mjs` 起。
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
        title="分享這面牆的公網連結（給不在同個 Wi-Fi 的人）"
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

  // fire-and-forget——不 await，clipboard 卡住也不會卡住 click handler。失敗
  // （無權限／非安全內容）就靜靜算了，使用者還能點網址欄自己選取複製。
  const copy = () => {
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      },
      () => {},
    )
  }

  // 這顆鈕住在工具列裡，而 .bar 有 backdrop-filter、.tb-right 有 transform——
  // 兩者都會讓 position:fixed 的 .scrim 以工具列（而非視窗）為定位基準，整個
  // 對話框被壓成一條。用 portal 把它掛到 <body> 底下，跟其他對話框一樣。
  return createPortal(
    <div className="scrim" {...scrimClose(onClose)}>
      <div
        className="sheet plain"
        role="dialog"
        aria-modal="true"
        aria-label="分享公網連結"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉">
          ×
        </button>
        <h2>分享這面牆</h2>
        <p className="dim">
          把這個網址給任何人（不用同一個 Wi-Fi）。他們要輸入共用密碼才進得來。
        </p>

        {qrSrc && (
          <div className="qr-box">
            <img src={qrSrc} alt="" width={200} height={200} />
          </div>
        )}

        <div className="sheet-actions" style={{ justifyContent: 'flex-start' }}>
          <input className="mono" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
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

        <p className="dim">
          免費 ngrok：每台裝置第一次打開會看到一頁 ngrok 提醒，按「Visit Site」就進得來。
          關掉啟動視窗後這個網址就失效；下次啟動會換一個新的。
        </p>

        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
