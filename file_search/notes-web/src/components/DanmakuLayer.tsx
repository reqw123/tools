import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'
import { useShareInfo } from '../hooks/useShareInfo'
import { subscribeDanmaku, type DanmakuMessage } from '../lib/liveSync'
import { api } from '../lib/api'
import { displayAuthor, readAuthorName } from '../lib/identity'
import { colorForAuthor } from '../lib/color'

/**
 * 彈幕——文字從畫面右側橫向捲動到左側，跟 `C:\question\multi\DanmakuSystem.js`
 * （問答遊戲那套）同一種做法搬過來：4 車道防重疊、量測實際寬度算精確動畫
 * 時長、車道選「最早空閒」的那條。**不用 React state 管每一則彈幕**——飄過去
 * 就該消失，用 state 驅動等於每則彈幕都要跑一次 re-render，直接操作 DOM
 * （跟原本 vanilla 版一樣）比較貼近這個場景的效能特性，也比較好照抄原本
 * 已經調過的動畫參數。輸入框／送出鈕另外用 React state 管（互動不頻繁，
 * 用 React 寫比較好維護）。
 *
 * 只在共用模式（多人）顯示——單機沒有「別人」，彈幕沒有意義，跟
 * ActivityTicker／HostPanel 同一個判斷。
 *
 * 懸浮鈕（`.danmaku-dock`）**可以拖曳到畫面任何位置**，按住 Pointer 移動超過
 * 一點距離才算拖曳（沒動就是一般點擊，開關輸入框）——跟 App.tsx 裁切視窗
 * 「⬅ 恢復完整畫面」按鈕的「按住拖曳／單純點擊」判斷同一種手法。位置存在
 * `localStorage`（純這個瀏覽器的個人偏好，不是牆面共用設定），視窗尺寸變了
 * （轉手機、調整瀏覽器視窗）會重新夾回畫面內，不會卡到看不見的地方。也有
 * 鍵盤快捷鍵：按 **Enter**（沒有聚焦在任何輸入欄位、也沒有對話框開著時）
 * 直接叫出輸入框，不用滑鼠點懸浮鈕。
 */
const LANES = 4
// 150px/s——原本照抄 quiz 專案的 120，實際在牆上看偏慢、字又偏小，兩個一起
// 調過：速度加快、字體放大（見 index.css 的 .danmaku-item），飄過畫面的
// 總時間沒有變太多，但視覺上明顯俐落／好認很多。
const SPEED = 150
const MAX_ON_SCREEN = 30
const MAX_CHARS = 60
const SAFE_TOP = 64 // 避開最上面的工具列／標題
const SAFE_BOTTOM = 96 // 避開右下角 ScrollButtons、左下角自己這顆懸浮鈕
const ITEM_HEIGHT_EST = 46 // 目前這組加大字體/內距後的大概高度，只用來算車道內垂直置中，不用非常精準

// ── 懸浮鈕拖曳定位 ───────────────────────────────────────────────────────
const DOCK_STORAGE_KEY = 'sticky-wall-danmaku-pos'
const DRAG_MARGIN = 10 // 離螢幕邊緣至少留這麼多，不會卡到邊角按不到
const FAB_SIZE = 46 // 懸浮鈕大概的邊長估計（桌面 44px／手機 48px 的中間值），只影響 clamp 邊界的幾 px
const COMPOSE_RESERVE = 300 // 展開輸入框的最大寬度估計——拖曳範圍留這個寬度，輸入框展開時
// 才不會在畫面右側被裁掉（見下面 clampPos 的 maxX）

interface DockPos {
  x: number
  y: number
}

function defaultPos(): DockPos {
  return { x: 16, y: window.innerHeight - FAB_SIZE - 16 } // 沒拖過的預設值＝原本的左下角
}

/** 夾回畫面內——拖曳中、載入舊座標、視窗尺寸變化後都會呼叫。 */
function clampPos(p: DockPos): DockPos {
  const maxX = Math.max(DRAG_MARGIN, window.innerWidth - Math.max(FAB_SIZE, COMPOSE_RESERVE) - DRAG_MARGIN)
  const maxY = Math.max(DRAG_MARGIN, window.innerHeight - FAB_SIZE - DRAG_MARGIN)
  return {
    x: Math.min(Math.max(p.x, DRAG_MARGIN), maxX),
    y: Math.min(Math.max(p.y, DRAG_MARGIN), maxY),
  }
}

function loadPos(): DockPos | null {
  try {
    const raw = localStorage.getItem(DOCK_STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<DockPos>
    if (typeof p.x === 'number' && typeof p.y === 'number') return clampPos({ x: p.x, y: p.y })
  } catch {
    /* private mode 等存取不到——退回預設位置就好 */
  }
  return null
}

function savePos(p: DockPos): void {
  try {
    localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* 存不進去不影響這次的拖曳結果，只是下次重整不會記得 */
  }
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  origX: number
  origY: number
  moved: boolean
}
const DRAG_THRESHOLD = 6 // px，超過才算「拖曳」不是「點擊」

export function DanmakuLayer() {
  const isShare = useShareInfo().mode === 'lan'
  const containerRef = useRef<HTMLDivElement>(null)
  const laneAtRef = useRef<number[]>(Array(LANES).fill(0))
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<DockPos>(() => loadPos() ?? defaultPos())
  const dragRef = useRef<DragState | null>(null)
  // 拖曳結束後，瀏覽器仍會照常在 pointerup 後補發一個原生 click——這個 flag
  // 讓那次 click 被吃掉，不會又把輸入框多開/關一次。只憑 pointer 事件本身
  // 沒辦法完全取代 onClick：鍵盤 Enter/Space 觸發按鈕只會生出 click，不會有
  // 任何 pointer 事件，所以「開關輸入框」還是要留在 onClick 這一層才對鍵盤
  // 使用者友善（跟 App.tsx 裁切視窗「⬅ 恢復完整畫面」按鈕同一種手法）。
  const justDraggedRef = useRef(false)

  useEffect(() => {
    if (!isShare) return

    // 暖機：第一則真的彈幕出現時會卡頓一下、之後都順——這是瀏覽器「第一次
    // 真的用到 `.danmaku-item` 這組樣式」才會付的一次性成本（漸層底＋多層
    // box-shadow／text-shadow 的繪製設定、will-change 觸發的 compositor
    // 圖層建立、`dk-slide` 這組 keyframes——含它裡面的 per-keyframe
    // animation-timing-function——第一次被瀏覽器解析/編譯），不是彈幕本身
    // 的邏輯變慢。用一個永遠在畫面外、看不到的假彈幕在掛載當下（頁面剛
    // 載入、還沒人在看）悄悄跑一次同一組樣式跟動畫，把這筆成本移到使用者
    // 看不到、也不在意的這一刻，不要留到他真的發第一則彈幕才付。
    const container = containerRef.current
    if (container) {
      const warm = document.createElement('div')
      warm.className = 'danmaku-item danmaku-warmup'
      container.appendChild(warm)
      void warm.offsetWidth // 跟 fire() 一樣強制觸發一次 layout，這正是要暖的那個成本
      warm.addEventListener('animationend', () => warm.remove(), { once: true })
    }

    return subscribeDanmaku(fire)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShare])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // 視窗尺寸變了（轉手機、調整瀏覽器視窗）就重新夾回畫面內——不然拖到邊緣後
  // 縮小視窗，懸浮鈕可能被推到看不見、點不到的地方。
  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 快捷鍵：Enter 叫出輸入框——沒有聚焦在任何輸入欄位、也沒有對話框
  // （`.scrim`）開著時才生效，不然會搶走其他表單「按 Enter 送出」的行為。
  useEffect(() => {
    if (!isShare) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || open) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      // 焦點本來就在這顆懸浮鈕自己身上（Tab 鍵切過去）——讓按鈕自己的鍵盤啟用
      // （Enter → click）處理就好，不要這裡也搶著開一次，變成一按同時觸發
      // 兩套邏輯、狀態被切兩次。
      if (t?.closest('.danmaku-dock')) return
      if (document.querySelector('.scrim')) return
      e.preventDefault()
      setOpen(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isShare, open])

  function fire(msg: DanmakuMessage) {
    const container = containerRef.current
    if (!container) return
    const text = msg.text.trim().slice(0, MAX_CHARS)
    if (!text) return

    if (container.children.length >= MAX_ON_SCREEN) container.firstElementChild?.remove()

    // 選最早空閒的車道——跟原版同一個規則。
    const laneAt = laneAtRef.current
    let lane = 0
    for (let i = 1; i < LANES; i++) if (laneAt[i] < laneAt[lane]) lane = i

    const el = document.createElement('div')
    el.className = 'danmaku-item'
    // 同一個人（同名字）的彈幕永遠同一個顏色，跟 colorForTag 同一套 hash 手法
    // 但換一組更鮮豔的飽和度/亮度，疊在深色漸層底上才夠亮、才分得出「這幾則
    // 是同一個人發的」——這是彈幕「不好辨識對象」這個問題的主要解法，不只是
    // 加大字體而已。
    const color = colorForAuthor(msg.author)
    el.style.setProperty('--dk-color', color)
    const nameEl = document.createElement('span')
    nameEl.className = 'danmaku-item-name'
    nameEl.textContent = displayAuthor(msg.author)
    const msgEl = document.createElement('span')
    msgEl.className = 'danmaku-item-msg'
    msgEl.textContent = text
    el.append(nameEl, msgEl)

    const safeH = window.innerHeight - SAFE_TOP - SAFE_BOTTOM
    const laneH = safeH / LANES
    const topPx = SAFE_TOP + lane * laneH + (laneH - ITEM_HEIGHT_EST) / 2
    el.style.top = `${Math.round(topPx)}px`
    el.style.left = `${window.innerWidth}px`

    container.appendChild(el)

    // 量測實際渲染寬度才能算出精確的飄過時間；速度加一點隨機擾動避免呆板。
    const elW = el.offsetWidth
    const travel = window.innerWidth + elW
    const speed = SPEED * (0.92 + Math.random() * 0.16)
    const duration = travel / speed
    el.style.setProperty('--dk-travel', `-${travel}px`)
    // 整體維持等速（linear）——這是彈幕好讀的關鍵，速度忽快忽慢反而難追。
    // 進場那一小段的「彈出」感改在 @keyframes 裡用 per-keyframe 的
    // animation-timing-function 蓋掉，只影響最前面那一小段，不影響整體等速。
    el.style.animation = `dk-slide ${duration.toFixed(2)}s linear both`
    // 車道再次空閒的時間點＝文字尾端離開起點。
    laneAt[lane] = Date.now() + (elW / SPEED) * 1000 + 150

    el.addEventListener('animationend', () => el.remove(), { once: true })
  }

  const send = () => {
    const value = text.trim().slice(0, MAX_CHARS)
    if (!value || sending) return
    setSending(true)
    setErr('')
    api
      .sendDanmaku(value)
      .then(() => {
        setText('')
        setOpen(false)
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setSending(false))
  }

  // ── 懸浮鈕拖曳 ─────────────────────────────────────────────────────────
  // 開關輸入框留給 onClick（見下面 button），這裡只負責偵測拖曳／重新定位。
  const onFabPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return // 滑鼠只認左鍵；觸控/觸控筆沒有這個概念
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, moved: false }
  }
  const onFabPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) d.moved = true
    if (d.moved) setPos(clampPos({ x: d.origX + dx, y: d.origY + dy }))
  }
  const onFabPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    dragRef.current = null
    if (!d.moved) return // 沒動過——交給接下來瀏覽器自己補發的 click 處理
    // 直接照最後一次移動量重算，不吃 pos 這個 state（避免 setState 非同步
    // 造成拿到舊值）；算完順便存進 localStorage，下次開牆記得住位置。
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    const final = clampPos({ x: d.origX + dx, y: d.origY + dy })
    setPos(final)
    savePos(final)
    justDraggedRef.current = true // 吃掉接下來那次 click，不要又切一次開關
  }
  const onFabPointerCancel = () => {
    dragRef.current = null
  }
  const onFabClick = () => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false
      return
    }
    setOpen((v) => !v)
  }

  if (!isShare) return null

  // 靠上半螢幕就往下展開輸入框、靠下半就往上展開——不管拖到哪裡，輸入框
  // 都不會被螢幕邊緣裁掉一部分。
  const expandDown = pos.y < window.innerHeight / 2
  const dockStyle: CSSProperties = expandDown
    ? { left: pos.x, top: pos.y, bottom: 'auto' }
    : { left: pos.x, bottom: window.innerHeight - pos.y - FAB_SIZE, top: 'auto' }

  return (
    <>
      <div className="danmaku-layer" ref={containerRef} aria-hidden />
      <div
        className={`danmaku-dock${open ? ' open' : ''}${expandDown ? ' expand-down' : ''}`}
        style={dockStyle}
      >
        {open && (
          <form
            className="danmaku-compose"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <input
              ref={inputRef}
              value={text}
              maxLength={MAX_CHARS}
              placeholder={`說句話飄過牆面…（${displayAuthor(readAuthorName())}）`}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false)
              }}
            />
            <button
              type="submit"
              className="danmaku-send-btn"
              disabled={!text.trim() || sending}
              aria-label="送出彈幕"
              title="送出"
            >
              <Send size={16} strokeWidth={2.4} aria-hidden />
            </button>
            {err && <p className="danmaku-err">{err}</p>}
          </form>
        )}
        <button
          type="button"
          className="danmaku-fab"
          aria-label={open ? '關閉彈幕輸入' : '發彈幕（按住可拖曳位置）'}
          title={open ? '關閉' : '發彈幕（Enter 快捷鍵；按住可拖曳到任何位置）'}
          onPointerDown={onFabPointerDown}
          onPointerMove={onFabPointerMove}
          onPointerUp={onFabPointerUp}
          onPointerCancel={onFabPointerCancel}
          onClick={onFabClick}
        >
          {open ? (
            <X size={20} strokeWidth={2.4} aria-hidden />
          ) : (
            <MessageCircle size={20} strokeWidth={2.4} aria-hidden />
          )}
        </button>
      </div>
    </>
  )
}
