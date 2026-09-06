import { useEffect, useMemo, useRef, useState } from 'react'
import { colorForTag } from '../lib/color'
import { useTagColors } from '../hooks/useNotes'

/**
 * 分類輸入框＋自訂下拉建議清單——取代原生 `<input list><datalist>`。原生
 * datalist 的下拉選單完全交給瀏覽器自己畫，字級小、樣式不可控（CSS 幾乎
 * 套不進去），每個瀏覽器/系統長得又不一樣，跟這個牆的紙感視覺完全脫節，
 * 使用者反映「文字太小、可讀性低、缺少獨立辨識性」。這裡自己刻一份：
 * 字級跟其他輸入框一致、每個建議項前面帶一個跟便利貼卡片同一套
 * `colorForTag()` 算出來的色點——不只是好讀，色點本身就是「獨立辨識性」，
 * 跟牆上卡片的顏色直接對得起來，不用另外發明一套視覺語言。
 */
export function TagInput({
  value,
  onChange,
  knownTags,
  placeholder,
  maxLength,
  disabled,
  id,
  autoFocus,
  className,
}: {
  value: string
  onChange: (v: string) => void
  knownTags: string[]
  placeholder?: string
  maxLength?: number
  disabled?: boolean
  id?: string
  autoFocus?: boolean
  /** 加在外層 wrapper 上，跟 tag-input 疊加——給呼叫端控制版面用（例如 flex 比例）。 */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)
  const { data: tagColors } = useTagColors()

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    const base = q ? knownTags.filter((t) => t.toLowerCase().includes(q)) : knownTags
    return base.slice(0, 20)
  }, [knownTags, value])

  // 點外面就收起——原生 datalist 這件事瀏覽器免費幫你做，自己刻就得自己補。
  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  const pick = (t: string) => {
    onChange(t)
    setOpen(false)
    setActiveIdx(-1)
  }

  return (
    <div className={`tag-input${className ? ` ${className}` : ''}`} ref={wrapRef}>
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActiveIdx(-1)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || matches.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiveIdx((i) => Math.min(matches.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIdx((i) => Math.max(0, i - 1))
          } else if (e.key === 'Enter' && activeIdx >= 0) {
            e.preventDefault()
            pick(matches[activeIdx])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul className="tag-suggest" role="listbox">
          {matches.map((t, i) => (
            <li key={t} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={i === activeIdx}
                className={`tag-suggest-item${i === activeIdx ? ' active' : ''}`}
                // 用 onMouseDown 擋掉 blur 搶在 click 前面把清單收起來，不然點下去選不到
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(t)}
              >
                <span className="tag-suggest-dot" style={{ background: colorForTag(t, tagColors) }} aria-hidden />
                {t}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
