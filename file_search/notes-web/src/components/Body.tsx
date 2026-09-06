import { useMemo } from 'react'
import { parseBody } from '../lib/format'

export function Body({ text, limit }: { text: string; limit?: number }) {
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
            <span>{line.text}</span>
            <i />
          </li>
        ) : (
          <li key={i} className="task">
            <b className="box" />
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
