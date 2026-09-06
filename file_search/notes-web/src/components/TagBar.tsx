import type { CSSProperties } from 'react'
import { colorForTag } from '../lib/color'
import { useTagColors } from '../hooks/useNotes'

export interface TagCount {
  tag: string
  count: number
}

export function TagBar({
  tags,
  active,
  total,
  onPick,
}: {
  tags: TagCount[]
  active: string | null
  total: number
  onPick: (t: string | null) => void
}) {
  const { data: tagColors } = useTagColors()
  return (
    <div className="chips" role="group" aria-label="依分類篩選">
      <button className="chip" aria-pressed={active === null} onClick={() => onPick(null)}>
        全部 <span className="n">{total}</span>
      </button>
      {tags.map(({ tag, count }) => (
        <button
          key={tag}
          className="chip"
          aria-pressed={active === tag}
          style={{ '--cd': colorForTag(tag, tagColors) } as CSSProperties}
          onClick={() => onPick(active === tag ? null : tag)}
        >
          <span className="dot" aria-hidden />
          {tag} <span className="n">{count}</span>
        </button>
      ))}
    </div>
  )
}
