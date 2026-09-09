import { useMemo } from 'react'
import { parseBody } from '../lib/format'

export function Body({
  text,
  limit,
  onToggleLine,
}: {
  text: string
  limit?: number
  /** 有給就讓待辦方框可點——點下去切換那一行的 [x]（srcIndex 是
   *  body.split('\n') 的行號）。沒給就畫成純裝飾的方框，跟以前一樣。 */
  onToggleLine?: (srcIndex: number) => void
}) {
  const parsed = useMemo(() => parseBody(text), [text])

  if ('paragraph' in parsed) {
    return <p className="para">{parsed.paragraph}</p>
  }

  const all = parsed.lines
  const shown = limit ? all.slice(0, limit) : all
  return (
    <ul className="lines">
      {shown.map((line, i) =>
        line.kind === 'field' ? (
          <li key={i} className="fld">
            <span className="fld-label">{line.label ?? line.text}</span>
            <span className="fld-fill">
              {line.value ? <span className="fld-value">{line.value}</span> : null}
            </span>
          </li>
        ) : (
          <li key={i} className={`task${line.checked ? ' done' : ''}`}>
            {onToggleLine ? (
              <button
                type="button"
                className="box"
                role="checkbox"
                aria-checked={line.checked ?? false}
                aria-label={line.text || '待辦項'}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleLine(line.srcIndex)
                }}
              />
            ) : (
              <b className="box" aria-hidden />
            )}
            <span>{line.text}</span>
          </li>
        ),
      )}
      {limit && all.length > limit && (
        <li className="more">還有 {all.length - limit} 項…</li>
      )}
    </ul>
  )
}
