import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Note } from './lib/api'
import { useNotes } from './hooks/useNotes'
import { useAiSearch, useAiTarget } from './hooks/useAi'
import { hasDesktopWall } from './lib/desktopWall'
import { Toolbar } from './components/Toolbar'
import { Wall } from './components/Wall'
import { CropOverlay } from './components/CropOverlay'
import { NoteDialog } from './components/NoteDialog'
import { ThemeToggle } from './components/ThemeToggle'
import { AiAnswerDialog } from './components/AiAnswerDialog'
import { AiSettingsDialog } from './components/AiSettingsDialog'
import { BatchCreateDialog } from './components/BatchCreateDialog'
import { BatchDeleteDialog } from './components/BatchDeleteDialog'
import { GenerateNotesDialog } from './components/GenerateNotesDialog'
import { ImportNotesDialog } from './components/ImportNotesDialog'
import { downloadStickyNotesHtml } from './lib/exportHtml'
import { downloadNotesJson } from './lib/exportJson'
import { getDefaultTag, setDefaultTag } from './lib/defaultTag'
import type { TagCount } from './components/TagBar'

// wallpaper-app 重開時用 `?floated=<JSON 陣列>` 把「已經是懸浮視窗」的便利貼
// id 帶回來（見 wallpaper-app/main.js 的 currentUrl()），讓 floatedIds 初始化
// 時就把它們濾掉。壞掉/沒有這個參數就回空集合，絕不因此讓整頁掛掉。
function parseFloated(): Set<string> {
  try {
    const raw = new URLSearchParams(location.search).get('floated')
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

type DialogState = { kind: 'new' } | { kind: 'open'; note: Note } | null
interface AiResult {
  query: string
  answer: string
  matchedIds: string[]
}

export function App() {
  const { data: notes, isLoading, isError, error } = useNotes()
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)

  const [aiMode, setAiMode] = useState(false)
  const [rawAiResult, setAiResult] = useState<AiResult | null>(null)
  const [answerDismissed, setAnswerDismissed] = useState(false)
  // AI 結果只在「搜尋框文字沒被改過」的期間有效——一旦文字跟送出當下的問題不同，
  // 那批命中的 id 不再對應目前輸入，直接當作沒有（不用 effect 去清 state）。
  const aiResult = rawAiResult && query.trim() === rawAiResult.query ? rawAiResult : null
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const { data: aiTarget } = useAiTarget()
  const aiSearch = useAiSearch()

  const [batchCreate, setBatchCreate] = useState(false)
  const [batchDelete, setBatchDelete] = useState(false)
  const [generateNotes, setGenerateNotes] = useState(false)
  const [importNotes, setImportNotes] = useState(false)
  const [defaultTag, setDefTag] = useState(getDefaultTag)
  const applyDefaultTag = useCallback((t: string) => {
    setDefaultTag(t)
    setDefTag(t.trim())
  }, [])

  // wallpaper-app 專屬手勢——網頁版（沒有 window.desktopWall）完全不會走到這兩個功能。
  // canFloat 只需要判斷一次：這個 API 存不存在在整個 session 期間不會變。
  const [canFloat] = useState(hasDesktopWall)
  // 拖出去變懸浮視窗的便利貼——牆上要跟著隱藏，不然同一則會兩邊都看得到。
  //
  // 初始值不是固定空集合——重開 wallpaper-app 時 restorePinnedWindows() 會
  // 把上次還開著的懸浮視窗還原回來，但這個 state 每次載入都歸零，主牆就不
  // 知道那幾則已經在外面漂著了。比照 croppedIds，wallpaper-app 開這個網頁時
  // 會帶 `?floated=<JSON 陣列>`（見 main.js 的 currentUrl()），這裡拿來初始
  // 化。一般瀏覽器打開（沒有這個參數）就是空集合。
  const [floatedIds, setFloatedIds] = useState<Set<string>>(() => parseFloated())
  // 拉框裁切選中的便利貼 id；null＝目前沒有在裁切模式。裁切狀態下這個集合
  // 決定牆上「只」顯示哪幾則，優先權比搜尋/分類/AI 篩選都高。
  //
  // 初始值不是固定 null——上次結束程式時如果還在裁切檢視中，wallpaper-app
  // 開這個網頁時網址會帶 `?crop=<id1,id2,...>`（見 main.js 的
  // currentUrl()），這裡直接拿來初始化。視窗本身的尺寸/位置也是主行程用
  // 同一份存檔資料在 createWall() 裡直接設定好的，網頁這邊不用再呼叫一次
  // cropTo。一般瀏覽器打開（沒有這個參數）就是平常的 null。
  const [croppedIds, setCroppedIds] = useState<Set<string> | null>(() => {
    const raw = new URLSearchParams(location.search).get('crop')
    return raw ? new Set(raw.split(',').filter(Boolean)) : null
  })

  useEffect(() => {
    if (!canFloat) return
    window.desktopWall?.onNoteUnpinned((id) => {
      setFloatedIds((s) => {
        if (!s.has(id)) return s
        const next = new Set(s)
        next.delete(id)
        return next
      })
    })
  }, [canFloat])

  const onDragOut = useCallback((note: Note, rect: DOMRect) => {
    window.desktopWall?.pinNote(
      { id: note.id },
      { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    )
    setFloatedIds((s) => new Set(s).add(note.id))
  }, [])

  const onCrop = useCallback((ids: string[], rect: { x: number; y: number; width: number; height: number }) => {
    setCroppedIds(new Set(ids))
    window.desktopWall?.cropTo(ids, rect)
  }, [])

  const restoreCrop = useCallback(() => {
    setCroppedIds(null)
    window.desktopWall?.restoreCrop()
  }, [])

  // 「⬅ 恢復完整畫面」按住不放拖曳＝搬動裁切出來的那個小視窗；放開時如果
  // 全程沒什麼位移才當一次點擊、真的觸發恢復——跟 Note.tsx 拖出去手勢同一種
  // 「按下開始追蹤、放開時看有沒有動過」分工，只是這裡搬的是視窗本身而不是
  // 卡片。按鈕本身視覺上是 position:fixed，不會跟著移動，移動的是整個視窗
  // （連同這顆按鈕一起被搬走），所以放開時滑鼠幾乎一定還壓在按鈕上——不能
  // 靠原生 click 有沒有觸發來判斷是否拖過，要自己記。
  const restoreDrag = useRef<{ moved: boolean } | null>(null)
  const justDraggedRestore = useRef(false)

  const onRestoreMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    restoreDrag.current = { moved: false }
  }, [])

  const onRestoreClick = useCallback(() => {
    if (justDraggedRestore.current) {
      justDraggedRestore.current = false
      return
    }
    restoreCrop()
  }, [restoreCrop])

  useEffect(() => {
    if (!croppedIds) return
    const onMove = (e: MouseEvent) => {
      const d = restoreDrag.current
      if (!d) return
      if (e.movementX || e.movementY) {
        d.moved = true
        window.desktopWall?.moveWallBy(e.movementX, e.movementY)
      }
    }
    const onUp = () => {
      const d = restoreDrag.current
      restoreDrag.current = null
      if (d) {
        justDraggedRestore.current = d.moved
        // 真的拖過（不是單純點擊）才需要把新位置存檔——見 main.js 的
        // wall-move-end，不要每個 mousemove 都寫一次磁碟。
        if (d.moved) window.desktopWall?.moveWallEnd()
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [croppedIds])

  const deferredQuery = useDeferredValue(query)
  const list = useMemo(() => notes ?? [], [notes])

  const tags = useMemo<TagCount[]>(() => {
    const m = new Map<string, number>()
    for (const n of list) if (n.tag) m.set(n.tag, (m.get(n.tag) ?? 0) + 1)
    return [...m.entries()]
      .map(([t, count]) => ({ tag: t, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hant'))
  }, [list])
  const knownTags = useMemo(() => tags.map((t) => t.tag), [tags])

  // 目前分類篩選底下的便利貼——AI 搜尋會把「這些」送出去
  const inScope = useMemo(
    () => (tag ? list.filter((n) => n.tag === tag) : list),
    [list, tag],
  )

  const shown = useMemo(() => {
    // 裁切中——只看框選到的那幾則，蓋過搜尋/分類/AI 篩選（使用者已經明確
    // 選出「就是這些」了，這時候還讓分類篩選之類的把它們濾掉會很反直覺）。
    // 但拖出去變懸浮視窗的還是要拿掉——裁切視窗是照當初框選的那幾則定size
    // 的，漏掉這個過濾會讓剛拖出去的那則繼續佔著裁切視窗裡的版位（同一則
    // 內容因此看起來像多了一份、版面也被撐壞），跟懸浮視窗那邊重複顯示。
    if (croppedIds) {
      const base = list.filter((n) => croppedIds.has(n.id))
      return floatedIds.size ? base.filter((n) => !floatedIds.has(n.id)) : base
    }

    let base: Note[]
    if (aiResult) {
      const ids = new Set(aiResult.matchedIds)
      base = list.filter((n) => ids.has(n.id))
    } else if (aiMode) {
      base = list // AI 模式還沒送出 → 先顯示範圍內全部
    } else {
      const q = deferredQuery.trim().toLowerCase()
      base = q
        ? list.filter(
            (n) =>
              n.title.toLowerCase().includes(q) ||
              n.body.toLowerCase().includes(q) ||
              n.tag.toLowerCase().includes(q),
          )
        : list
    }
    if (tag) base = base.filter((n) => n.tag === tag)
    // 拖出去變懸浮視窗的便利貼從牆上拿掉——懸浮視窗那邊（FocusedNote）自己顯示。
    return floatedIds.size ? base.filter((n) => !floatedIds.has(n.id)) : base
  }, [list, tag, deferredQuery, aiMode, aiResult, croppedIds, floatedIds])

  const clearAi = useCallback(() => {
    setAiResult(null)
    setAnswerDismissed(false)
    aiSearch.reset()
  }, [aiSearch])

  const closeDialog = useCallback(() => {
    setDialog(null)
    setAiResult(null) // 便利貼增刪改後，AI 命中清單就不保證對得上了
  }, [])

  const runAiSearch = useCallback(
    (q: string) => {
      const question = q.trim()
      if (!question || aiSearch.isPending) return
      aiSearch.mutate(
        { query: question, tag },
        {
          onSuccess: (r) => {
            setAiResult({ query: question, answer: r.answer, matchedIds: r.matchedIds })
            setAnswerDismissed(false)
          },
        },
      )
    },
    [aiSearch, tag],
  )

  const toggleAiMode = useCallback(() => {
    setAiMode((m) => {
      if (m) clearAi()
      return !m
    })
    setQuery('')
  }, [clearAi])

  const anyDialogOpen =
    !!dialog || batchCreate || batchDelete || generateNotes || importNotes || aiSettingsOpen
  // 已經在裁切中就不能再拉一次框——先恢復完整畫面才能重新選——不然兩個裁切
  // 範圍疊在一起的語意會很奇怪。
  const cropActive = canFloat && !anyDialogOpen && !croppedIds

  return (
    <div className={`page${croppedIds ? ' cropped' : ''}`}>
      {croppedIds && (
        <button
          className="crop-restore"
          onMouseDown={onRestoreMouseDown}
          onClick={onRestoreClick}
          title="點一下恢復完整畫面；按住拖曳可以移動這個裁切視窗"
        >
          ⬅ 恢復完整畫面
        </button>
      )}
      <CropOverlay active={cropActive} onCrop={onCrop} />
      <header className="hero">
        <p className="eyebrow mono">Sticky Wall · file_search_app</p>
        <h1 className="brush">
          釘在牆上的<em>便利貼</em>
        </h1>
        <p className="lede">
          桌面工具「檔案快速搜尋」裡的便利貼——常用指令、清單、備忘與願望，依分類自動配色。
          這面牆即時反映資料庫（新增／編輯／刪除馬上出現），也能用 AI 用一般語句問問題。
        </p>
        <div className="stat-row mono">
          <span className="stat">
            <b>{list.length}</b>
            <span>則便利貼</span>
          </span>
          <span className="stat">
            <b>{tags.length}</b>
            <span>種分類</span>
          </span>
          <span className="stat">
            <b>{shown.length}</b>
            <span>目前顯示</span>
          </span>
        </div>
      </header>

      <Toolbar
        query={query}
        onQuery={setQuery}
        tag={tag}
        onTag={setTag}
        tags={tags}
        total={list.length}
        onAdd={() => setDialog({ kind: 'new' })}
        aiMode={aiMode}
        onToggleAiMode={toggleAiMode}
        onAiSearch={runAiSearch}
        aiTarget={aiTarget}
        aiSearching={aiSearch.isPending}
        aiError={aiSearch.error?.message ?? null}
        sendCount={inScope.length}
        onOpenAiSettings={() => setAiSettingsOpen(true)}
        onExport={() => {
          if (shown.length) void downloadStickyNotesHtml(shown)
        }}
        exportCount={shown.length}
        onExportJson={() => void downloadNotesJson()}
        onImportJson={() => setImportNotes(true)}
        onBatchCreate={() => setBatchCreate(true)}
        onBatchDelete={() => setBatchDelete(true)}
        onGenerateNotes={() => setGenerateNotes(true)}
      />

      {aiResult && (
        <div className="ai-banner mono">
          <span>
            🤖 AI 搜尋「{aiResult.query}」— 命中 {shown.length} 則
          </span>
          <button className="link" onClick={() => setAnswerDismissed(false)}>
            看回答
          </button>
          <button className="link" onClick={clearAi}>
            清除
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="notice mono">// 載入中…</p>
      ) : isError ? (
        <p className="notice err mono">// 讀取失敗：{error.message}（後端有啟動嗎？）</p>
      ) : shown.length === 0 ? (
        <p className="notice mono">
          //{' '}
          {aiResult
            ? 'AI 沒有對到任何便利貼'
            : list.length === 0
              ? '還沒有便利貼，點右上角「新增便利貼」'
              : `沒有符合「${query}」的便利貼`}
        </p>
      ) : (
        <Wall
          key={`${deferredQuery}|${tag ?? ''}|${aiResult?.query ?? ''}|${croppedIds ? [...croppedIds].sort().join(',') : ''}`}
          notes={shown}
          onOpen={(n) => setDialog({ kind: 'open', note: n })}
          floatable={canFloat}
          onDragOut={onDragOut}
        />
      )}

      <footer className="colophon">
        資料檔：<b>indexes/.sticky_notes.json</b>（跟桌面版共用）。AI 搜尋走
        <b> ai_bridge.py</b> 呼叫 file_search_app 既有的
        <b> StickyNoteService / AIDescriptionService</b>——組 prompt、呼叫 Provider、解析回應，
        設定與用量計數也跟桌面版共用。<br />
        技術棧：Vite + React 19 + TypeScript + Tailwind 4 · Fastify · TanStack Query。
      </footer>

      <ThemeToggle />

      {dialog && (
        <NoteDialog
          note={dialog.kind === 'open' ? dialog.note : null}
          initialMode={dialog.kind === 'new' ? 'new' : 'view'}
          knownTags={knownTags}
          defaultTag={defaultTag}
          onClose={closeDialog}
        />
      )}
      {batchCreate && (
        <BatchCreateDialog
          knownTags={knownTags}
          defaultTag={defaultTag}
          onClose={() => setBatchCreate(false)}
          onDone={(t) => {
            applyDefaultTag(t)
            setBatchCreate(false)
          }}
        />
      )}
      {batchDelete && (
        <BatchDeleteDialog notes={list} onClose={() => setBatchDelete(false)} />
      )}
      {generateNotes && (
        <GenerateNotesDialog
          knownTags={knownTags}
          onClose={() => setGenerateNotes(false)}
          // 便利貼增刪改後，AI 搜尋命中清單就不保證對得上了（同 closeDialog）；
          // 新便利貼是否存成功、存了幾則都已經在牆上看得到，不用另外顯示 toast。
          onDone={() => setAiResult(null)}
        />
      )}
      {importNotes && (
        <ImportNotesDialog
          onClose={() => {
            setImportNotes(false)
            setAiResult(null) // 匯入可能新增便利貼，AI 搜尋命中清單就不保證對得上了
          }}
        />
      )}
      {aiResult && !answerDismissed && (
        <AiAnswerDialog
          query={aiResult.query}
          answer={aiResult.answer}
          matchedCount={shown.length}
          onClose={() => setAnswerDismissed(true)}
        />
      )}
      {aiSettingsOpen && <AiSettingsDialog onClose={() => setAiSettingsOpen(false)} />}
    </div>
  )
}
