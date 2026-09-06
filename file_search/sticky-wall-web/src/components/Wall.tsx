import type { Note as NoteT } from '../lib/api'
import { Note } from './Note'

export function Wall({
  notes,
  onOpen,
  floatable,
  onDragOut,
}: {
  notes: NoteT[]
  onOpen: (n: NoteT) => void
  floatable?: boolean
  onDragOut?: (note: NoteT, rect: DOMRect) => void
}) {
  return (
    <main className="wall enter">
      {notes.map((n, i) => (
        <Note key={n.id} note={n} index={i} onOpen={onOpen} floatable={floatable} onDragOut={onDragOut} />
      ))}
    </main>
  )
}
