import { useEffect, useState } from 'react'
import { ChevronsDown, ChevronsUp } from 'lucide-react'

/**
 * 右下角浮動的「捲到最上面 / 最下面」——內容比一個畫面還高才出現。
 * 雙牆（notes-web / files-web）各一份，是既有的不共用前端慣例。
 */
export function ScrollButtons() {
  const [scrollable, setScrollable] = useState(false)

  useEffect(() => {
    const check = () =>
      setScrollable(document.documentElement.scrollHeight > window.innerHeight + 120)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(document.body)
    window.addEventListener('resize', check)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', check)
    }
  }, [])

  if (!scrollable) return null

  return (
    <div className="scroll-fab">
      <button
        type="button"
        title="捲到最上面"
        aria-label="捲到最上面"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      >
        <ChevronsUp size={18} strokeWidth={2.4} aria-hidden />
      </button>
      <button
        type="button"
        title="捲到最下面"
        aria-label="捲到最下面"
        onClick={() =>
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
        }
      >
        <ChevronsDown size={18} strokeWidth={2.4} aria-hidden />
      </button>
    </div>
  )
}
