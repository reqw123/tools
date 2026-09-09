import { useEffect, useRef, useState } from 'react'
import { scrimClose } from '../lib/scrimClose'

/** AI 搜尋的自然語言回答——可捲動、可整段複製。牆上同時已經篩成命中的便利貼。 */
export function AiAnswerDialog({
  query,
  answer,
  matchedCount,
  onClose,
}: {
  query: string
  answer: string
  matchedCount: number
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="scrim" {...scrimClose(onClose)}>
      <div
        className="sheet answer"
        role="dialog"
        aria-modal="true"
        aria-label="AI 回答"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉">
          ×
        </button>
        <p className="answer-q mono">🤖 「{query}」</p>
        <div className="answer-body">{answer}</div>
        <footer>
          <span className="mono answer-count">牆上已篩出 {matchedCount} 則</span>
        </footer>
        <div className="sheet-actions">
          <button
            className="btn ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(answer)
              setCopied(true)
              setTimeout(() => setCopied(false), 1400)
            }}
          >
            {copied ? '已複製 ✓' : '複製回答'}
          </button>
          <button className="btn" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}
