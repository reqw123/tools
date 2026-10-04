import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { CircleCheck, PictureInPicture2, Undo2 } from 'lucide-react'
import type { Note, TagColors } from '../lib/api'
import { colorForTag } from '../lib/color'
import { scrimClose } from '../lib/scrimClose'

/**
 * 懸浮便利貼已達上限時，拖曳被擋下來跳的警告。列出目前懸浮中的便利貼，
 * 每則可以直接「收回」（wallpaper-app 有 unpinNote 才顯示），收到上限以下
 * 標題改成「可以再拖出」——不用關掉視窗自己去找那些小視窗。
 *
 * 上限的理由見 App.tsx 的 MAX_FLOATING_NOTES。
 */
export function FloatLimitDialog({
  floated,
  max,
  tagColors,
  onUnpin,
  onClose,
}: {
  /** 目前懸浮中的便利貼；找不到資料的（例如在另一個分頁）只有 id。 */
  floated: { id: string; note?: Note }[]
  max: number
  tagColors?: TagColors
  /** 沒給＝這版 wallpaper-app 不支援從主牆收回，「收回」按鈕整組不顯示。 */
  onUnpin?: (id: string) => void
  onClose: () => void
}) {
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    okRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const n = floated.length
  const full = n >= max
  const over = n - max // 之前留下、超過上限的數量（> 0 才顯示）

  return (
    <div className="scrim" {...scrimClose(onClose)}>
      <div
        className={`sheet plain float-limit${full ? '' : ' ok'}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fl-title"
        aria-describedby="fl-lead"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fl-badge" aria-hidden>
          {full ? <PictureInPicture2 size={26} strokeWidth={1.8} /> : <CircleCheck size={26} strokeWidth={1.8} />}
        </div>

        <h2 id="fl-title">{full ? '懸浮便利貼已經滿了' : `可以再拖出 ${max - n} 則了`}</h2>
        <p id="fl-lead" className="fl-lead">
          {full ? (
            over > 0 ? (
              <>
                桌面上最多同時懸浮 <b>{max}</b> 則，目前有 <b>{n}</b> 則（多出的是之前留下的）。
                收回到 <b>{max - 1}</b> 則以下，就能再拖出新的。
              </>
            ) : (
              <>
                桌面上最多同時懸浮 <b>{max}</b> 則。先收回一則，就能再拖出新的。
              </>
            )
          ) : (
            <>關掉這個視窗，再把便利貼拖到牆的邊緣就行。</>
          )}
        </p>

        <div className="fl-meter" role="img" aria-label={`懸浮中 ${n} 則，上限 ${max} 則`}>
          {Array.from({ length: max }, (_, i) => (
            <span key={i} className={`fl-slot${i < n ? ' on' : ''}`} />
          ))}
          <span className="fl-count mono">
            {n} / {max}
            {over > 0 && <em> +{over}</em>}
          </span>
        </div>

        {n > 0 && (
          <ul className="fl-list">
            {floated.map(({ id, note }) => (
              <li key={id} style={{ '--fl-chip': colorForTag(note?.tag ?? '', tagColors) } as CSSProperties}>
                <span className="fl-swatch" aria-hidden />
                <span className="fl-name">
                  {note ? note.title || '（無標題）' : '（另一個分頁的便利貼）'}
                  {note?.tag && <small># {note.tag}</small>}
                </span>
                {onUnpin && (
                  <button type="button" className="fl-unpin" onClick={() => onUnpin(id)}>
                    <Undo2 size={14} strokeWidth={2} />
                    收回
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="fl-actions">
          <button type="button" className="btn fl-ok" ref={okRef} onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}
