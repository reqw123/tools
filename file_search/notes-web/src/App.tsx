import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Note, NoteCollection } from './lib/api'
import { getApiCollection, setApiCollection } from './lib/api'
import {
  TAG_COLORS_KEY, useAppSettings, useNotes, usePatchAppSettings, useReminderSettings, useTagColors,
} from './hooks/useNotes'
import { useMinuteTick } from './hooks/useMinuteTick'
import { useAiSearch, useAiTarget, useSemanticSearch, useSemanticStatus } from './hooks/useAi'
import { hasDesktopWall } from './lib/desktopWall'
import { dueStatus } from './lib/format'
import {
  hasTodoItems, openTodoCount, readNoteSort, saveNoteSort, sortNotes, type NoteSort,
} from './lib/noteSort'
import { Toolbar } from './components/Toolbar'
import { Wall } from './components/Wall'
import { CropOverlay } from './components/CropOverlay'
import { NoteDialog } from './components/NoteDialog'
import { AiAnswerDialog } from './components/AiAnswerDialog'
import { GlobalSettingsDialog, type SettingsTab } from './components/GlobalSettingsDialog'
import { BatchCreateDialog } from './components/BatchCreateDialog'
import { BatchDeleteDialog } from './components/BatchDeleteDialog'
import { BatchTagDialog } from './components/BatchTagDialog'
import { GenerateNotesDialog } from './components/GenerateNotesDialog'
import { ThesisSeedDialog } from './components/ThesisSeedDialog'
import { ImportNotesDialog } from './components/ImportNotesDialog'
import { TrashDialog } from './components/TrashDialog'
import { HistoryDialog } from './components/HistoryDialog'
import { ScrollButtons } from './components/ScrollButtons'
import { downloadStickyNotesHtml } from './lib/exportHtml'
import { downloadNotesJson } from './lib/exportJson'
import { orderTags, tagRecency } from './lib/tagOrder'
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
  const qc = useQueryClient()
  const { data: notes, isLoading, isError, error } = useNotes()
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [noteSort, setNoteSort] = useState<NoteSort>(readNoteSort)
  const changeNoteSort = useCallback((v: NoteSort) => {
    setNoteSort(v)
    saveNoteSort(v)
  }, [])
  const [dialog, setDialog] = useState<DialogState>(null)

  // 「研究生模式」——整面牆換成論文專案專用的另一份便利貼（見 lib/api 的
  // x-note-collection）。只在桌面牆（wallpaper）出現；瀏覽器維持單純的生活牆。
  const [collection, setCollection] = useState<NoteCollection>(getApiCollection)
  const switchCollection = useCallback(
    (c: NoteCollection) => {
      if (c === getApiCollection()) return
      setApiCollection(c)
      setCollection(c)
      setQuery('')
      setTag(null)
      // 兩份便利貼的清單／垃圾桶／版本記錄／標籤色都不同 → 整包重抓
      qc.removeQueries()
    },
    [qc],
  )

  // 「只看快到期／已逾期」——疊加在其他篩選之上，開啟時同時把排序從「最新
  // 建立在上」換成「最早到期在上」，見下面 shown 的計算。
  const [dueOnly, setDueOnly] = useState(false)
  // 每分鐘翻新一次，讓到期徽章／「只看快到期」篩選隨時間自己更新（見下面
  // shown 的 deps）——純視覺，不是鬧鐘。
  const minuteTick = useMinuteTick()
  const { data: reminderSettings } = useReminderSettings()
  const { data: tagColors } = useTagColors()
  const { data: appSettings } = useAppSettings()
  const patchAppSettings = usePatchAppSettings()
  const tagSort = useMemo(
    () => appSettings?.tagSort ?? { mode: 'count' as const, order: [] },
    [appSettings],
  )
  // 工具列「同分類排列方向」快捷——跟「全域設定 → 外觀」是同一個 wall.tagAxis。
  const wallTagAxis = appSettings?.wall.tagAxis ?? 'vertical'
  const wallMasonry = appSettings?.wall.masonry ?? true
  const toggleTagAxis = useCallback(() => {
    patchAppSettings.mutate({
      wall: { tagAxis: wallTagAxis === 'horizontal' ? 'vertical' : 'horizontal' },
    })
  }, [patchAppSettings, wallTagAxis])

  // 「語意搜尋」——用本機 Ollama embedding 依相似度排序，跟 aiMode 互斥
  // （兩種都是「換一種搜尋方式」，同時開沒有意義）。
  const [semanticOn, setSemanticOn] = useState(false)

  const [aiMode, setAiMode] = useState(false)
  const [rawAiResult, setAiResult] = useState<AiResult | null>(null)
  const [answerDismissed, setAnswerDismissed] = useState(false)
  // AI 結果只在「搜尋框文字沒被改過」的期間有效——一旦文字跟送出當下的問題不同，
  // 那批命中的 id 不再對應目前輸入，直接當作沒有（不用 effect 去清 state）。
  const aiResult = rawAiResult && query.trim() === rawAiResult.query ? rawAiResult : null
  const [settingsOpen, setSettingsOpen] = useState<SettingsTab | null>(null)
  const { data: aiTarget } = useAiTarget()
  const aiSearch = useAiSearch()

  const [batchCreate, setBatchCreate] = useState(false)
  const [batchTag, setBatchTag] = useState(false)
  const [batchDelete, setBatchDelete] = useState(false)
  const [generateNotes, setGenerateNotes] = useState(false)
  const [thesisSeed, setThesisSeed] = useState(false)
  const [importNotes, setImportNotes] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
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
      // 懸浮視窗是獨立的網頁行程、有自己的 query 快取——它在那邊改的內容／標籤
      // 顏色／勾記／刪除，主牆這邊不會自動知道。收回時強制重抓，不然要等
      // staleTime 過或視窗重新聚焦才同步（見 files-web 回報的「改了顏色只作用於他」）。
      qc.invalidateQueries({ queryKey: ['notes'] })
      qc.invalidateQueries({ queryKey: TAG_COLORS_KEY })
    })
  }, [canFloat, qc])

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
  // note.id → 未完成待辦數（給「未完成待辦最多／最少」排序用，算一次就好）。
  const todoCounts = useMemo(() => new Map(list.map((n) => [n.id, openTodoCount(n.body)])), [list])
  // 「真的有待辦框」的便利貼 id——「未完成待辦最少」排序只看這些。
  const todoNoteIds = useMemo(
    () => new Set(list.filter((n) => hasTodoItems(n.body)).map((n) => n.id)),
    [list],
  )

  // 語意搜尋：開關開著且查詢句非空時自動跑（隨 deferredQuery 去抖動後重查）。
  const semanticStatus = useSemanticStatus(semanticOn)
  const semantic = useSemanticSearch(deferredQuery, tag, semanticOn)
  const semanticData = semantic.data
  // 只有 Ollama 真的回了結果才拿來排序；連不上（ok:false）就當它不存在，
  // 下面的 shown 會自動退回關鍵字比對。
  const semanticRank = useMemo(() => {
    if (!semanticOn || !semanticData?.ok) return null
    return new Map(semanticData.results.map((r) => [r.id, r.score]))
  }, [semanticOn, semanticData])
  const semanticActive = semanticRank !== null && !!deferredQuery.trim()

  // 橫向分類列的順序＝「全域設定」的 tagSort（手動釘的排最前，其餘依 mode
  // 自動排）。knownTags 由此衍生，牆面「看全部」時的同色系分欄也吃這個順序，
  // 兩邊一致。
  const tagRecencyMap = useMemo(() => tagRecency(list), [list])
  const tags = useMemo<TagCount[]>(() => {
    const m = new Map<string, number>()
    for (const n of list) if (n.tag) m.set(n.tag, (m.get(n.tag) ?? 0) + 1)
    const live = [...m.entries()].map(([tag, count]) => ({ tag, count }))
    const cm = new Map(live.map((t) => [t.tag, t.count]))
    return orderTags(live, tagSort, tagRecencyMap).map((tag) => ({ tag, count: cm.get(tag) ?? 0 }))
  }, [list, tagSort, tagRecencyMap])
  const knownTags = useMemo(() => tags.map((t) => t.tag), [tags])

  // 目前分類篩選底下的便利貼——AI 搜尋會把「這些」送出去
  const inScope = useMemo(
    () => (tag ? list.filter((n) => n.tag === tag) : list),
    [list, tag],
  )

  // 「排序 = 不指定」且「什麼都沒篩，就是在看全部」時：把 notes 依分類排好序
  // （釘選在最前），並把 groupByTag 傳給 Wall → Wall 改用「一個分類一直行／
  // 一橫段」的排版（見 Wall 的 columnPerTag），置頂的幾個分類因此並排、都看得到。
  // 一旦有搜尋／選了分類／AI／只看快到期，或使用者在下拉挑了明確的排序（最新
  // 建立…），就一律攤平照那個排——新建的便利貼才會確實排到最前面。
  // 「看全部」＝沒有任何篩選（croppedIds / AI / 語意 / 搜尋 / 選了分類 / 只看快到期）。
  const viewingAll =
    !croppedIds && !aiResult && !aiMode && !semanticOn && !deferredQuery.trim() && !tag && !dueOnly
  const groupByTag = noteSort === 'auto' && viewingAll
  // 「同分類集中（分類間隔開）」排序——看全部限定：同分類的便利貼排在一起，
  // 每個分類自成一「帶」、帶之間硬換行＋分隔線（Wall 的 bandByTag）。
  const tagBands = noteSort === 'tag-band' && viewingAll

  // 排序下拉在這幾種狀態下完全被覆蓋（見下面 shown 的計算）——工具列把它停用
  // ＋滑鼠提示說明目前實際照什麼排，免得使用者以為下拉壞了。
  const sortLocked = dueOnly
    ? '「只看快到期」開著時一律依到期日由早到晚排（釘選在最前）——關掉才能改排序'
    : aiResult
      ? 'AI 搜尋結果依相關程度排序——按上面「清除」才能改回一般排序'
      : semanticActive
        ? '語意搜尋結果依相似度排序——關掉「🌱 語意」才能改回一般排序'
        : undefined

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
      // matchedIds 依 AI 回的相關程度排序——照那個順序取，最相關的排最前面
      const byId = new Map(list.map((n) => [n.id, n]))
      base = aiResult.matchedIds.map((id) => byId.get(id)).filter((n): n is Note => !!n)
    } else if (aiMode) {
      base = list // AI 模式還沒送出 → 先顯示範圍內全部
    } else if (semanticActive && semanticRank) {
      // 語意命中：只留跨過相似度門檻的，依分數高到低排（分數同再依原順序）
      base = list
        .filter((n) => semanticRank.has(n.id))
        .sort((a, b) => (semanticRank.get(b.id) ?? 0) - (semanticRank.get(a.id) ?? 0))
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
    if (dueOnly) {
      // 疊加在其他篩選之上，同時把排序從工具列選的那個換成「最早到期在上」
      // ——due_at 是 ISO 字串，字典序排序就是時間序，不用另外解析。
      const soonHours = reminderSettings?.dueSoonHours
      base = base
        .filter((n) => dueStatus(n.due_at, soonHours))
        // 釘選的仍排最前面，其餘依到期日由早到晚。
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.due_at < b.due_at ? -1 : 1))
    } else if (!aiResult && !(semanticActive && semanticRank)) {
      // 「未完成待辦最少」：沒有任何待辦框的便利貼不列入（會被當成 0 排到最前，沒意義）。
      if (noteSort === 'todo-least') base = base.filter((n) => todoNoteIds.has(n.id))
      // AI／語意搜尋有自己的「依相關度排」，不套工具列的排序；其餘一律套。
      base = sortNotes(base, noteSort, todoCounts)
    }
    if (groupByTag || tagBands) {
      // 依分類分群（'auto' 的分區排版、'tag-band' 的分類帶都要）：釘選的維持在
      // 最前面（Wall 排成頂端一列）；其餘依分類分群，群序跟工具列分類 chip 一致
      // （＝「全域設定」的 tagSort），無分類的殿後，群內維持 created_at 由新到舊。
      // base 已排好（釘選在前），這裡 stable sort 只再按分類分群，群內順序不變。
      const rank = new Map(knownTags.map((t, i) => [t, i]))
      const tagRank = (t: string) => (t ? (rank.get(t) ?? knownTags.length) : knownTags.length + 1)
      base = [
        ...base.filter((n) => n.pinned),
        ...[...base.filter((n) => !n.pinned)].sort((a, b) => tagRank(a.tag) - tagRank(b.tag)),
      ]
    }
    // 拖出去變懸浮視窗的便利貼從牆上拿掉——懸浮視窗那邊（FocusedNote）自己顯示。
    return floatedIds.size ? base.filter((n) => !floatedIds.has(n.id)) : base
    // minuteTick：每分鐘重算，讓「只看快到期」的篩選/排序隨時間翻新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, tag, deferredQuery, aiMode, aiResult, semanticActive, semanticRank, croppedIds, floatedIds, dueOnly, reminderSettings, minuteTick, groupByTag, tagBands, knownTags, noteSort, todoCounts, todoNoteIds])

  // 詳細視窗的「上一則／下一則」——在目前這份篩選/排序出的清單（shown）裡移
  // 動，不是整份未篩選清單，這樣使用者在「只看快到期」之類的篩選底下瀏覽
  // 時，上一則/下一則走的也是眼前看得到的這批，不會跳到篩選掉的項目。
  const openNote = dialog?.kind === 'open' ? dialog.note : null
  const openIndex = openNote ? shown.findIndex((n) => n.id === openNote.id) : -1
  const goToOffset = useCallback(
    (delta: number) => {
      const next = shown[openIndex + delta]
      if (next) setDialog({ kind: 'open', note: next })
    },
    [openIndex, shown],
  )

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
    setSemanticOn(false)
    setQuery('')
  }, [clearAi])

  const toggleSemantic = useCallback(() => {
    setSemanticOn((s) => !s)
    setAiMode(false)
    clearAi()
    setQuery('')
  }, [clearAi])

  const anyDialogOpen =
    !!dialog || batchCreate || batchTag || batchDelete || generateNotes || thesisSeed || importNotes ||
    trashOpen || historyOpen || settingsOpen !== null
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
        <p className="eyebrow mono">
          {collection === 'thesis' ? 'Thesis Wall · 研究生模式' : 'Sticky Wall · file_search_app'}
        </p>
        <h1 className="brush">
          {collection === 'thesis' ? (
            <>
              論文專案的<em>便利貼</em>
            </>
          ) : (
            <>
              釘在牆上的<em>便利貼</em>
            </>
          )}
        </h1>
        <p className="lede">
          {collection === 'thesis'
            ? '「研究生模式」——這面牆只放論文專案（貓咪行為辨識系統）相關的便利貼，存在專案資料夾裡、跟生活便利貼完全分開。可用「從專案生成」讓 AI 讀專案文件產出任務便利貼。'
            : '桌面工具「檔案快速搜尋」裡的便利貼——常用指令、清單、備忘與願望，依分類自動配色。這面牆即時反映資料庫（新增／編輯／刪除馬上出現），也能用 AI 用一般語句問問題。'}
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
        sort={noteSort}
        onSort={changeNoteSort}
        tag={tag}
        onTag={setTag}
        tags={tags}
        total={list.length}
        collection={collection}
        onSwitchCollection={switchCollection}
        onAdd={() => setDialog({ kind: 'new' })}
        aiMode={aiMode}
        onToggleAiMode={toggleAiMode}
        onAiSearch={runAiSearch}
        semanticOn={semanticOn}
        onToggleSemantic={toggleSemantic}
        semanticState={
          !semanticOn
            ? null
            : semantic.isFetching
              ? { kind: 'loading' }
              : semanticData && !semanticData.ok
                ? { kind: 'error', message: semanticData.error ?? 'Ollama 無法使用' }
                : semanticStatus.data && !semanticStatus.data.ok
                  ? {
                      kind: 'error',
                      message:
                        semanticStatus.data.error ??
                        `Ollama 沒有 embedding 模型「${semanticStatus.data.model}」`,
                    }
                  : semanticActive && semanticData
                    ? {
                        kind: 'ok',
                        count: semanticData.results.length,
                        model: semanticData.model,
                        topScore: semanticData.top_score,
                      }
                    : { kind: 'idle', model: semanticStatus.data?.model ?? '' }
        }
        aiTarget={aiTarget}
        aiSearching={aiSearch.isPending}
        aiError={aiSearch.error?.message ?? null}
        sendCount={inScope.length}
        onOpenSettings={(t) => setSettingsOpen(t ?? 'ai')}
        onExport={() => {
          if (shown.length) {
            // 匯出比照牆上目前的狀態：動態排版關掉時分類分區／直橫向無效（匯出用
            // 最單純的 column-major），開著時才把 groupByTag / tagAxis / tagBands 帶過去。
            void downloadStickyNotesHtml(shown, {
              tagColors,
              defaultNoteColor: appSettings?.defaultNoteColor,
              minColWidth: appSettings?.wall.minColWidth,
              columnPerTag: groupByTag && wallMasonry,
              tagAxis: wallMasonry ? wallTagAxis : 'vertical',
              bandByTag: tagBands && wallMasonry,
            })
          }
        }}
        exportCount={shown.length}
        onExportJson={() => void downloadNotesJson()}
        onImportJson={() => setImportNotes(true)}
        onBatchCreate={() => setBatchCreate(true)}
        onBatchTag={() => setBatchTag(true)}
        onBatchDelete={() => setBatchDelete(true)}
        dueOnly={dueOnly}
        onToggleDueOnly={() => setDueOnly((v) => !v)}
        sortLocked={sortLocked}
        tagAxis={wallTagAxis}
        masonryOn={wallMasonry}
        onToggleTagAxis={toggleTagAxis}
        onGenerateNotes={() => setGenerateNotes(true)}
        onThesisSeed={() => setThesisSeed(true)}
        onTrash={() => setTrashOpen(true)}
        onHistory={() => setHistoryOpen(true)}
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
              : noteSort === 'todo-least' && !query.trim() && !tag
                ? '目前這個範圍沒有含待辦框的便利貼（「未完成待辦最少」只列有待辦的）'
                : `沒有符合「${query}」的便利貼`}
        </p>
      ) : (
        <Wall
          key={`${collection}|${deferredQuery}|${tag ?? ''}|${aiResult?.query ?? ''}|${croppedIds ? [...croppedIds].sort().join(',') : ''}`}
          notes={shown}
          onOpen={(n) => setDialog({ kind: 'open', note: n })}
          floatable={canFloat}
          onDragOut={onDragOut}
          minColWidth={appSettings?.wall.minColWidth}
          masonry={wallMasonry}
          columnPerTag={groupByTag}
          tagAxis={wallTagAxis}
          bandByTag={tagBands}
          tagColors={tagColors}
        />
      )}

      <footer className="colophon">
        資料檔：<b>indexes/.sticky_notes.json</b>（跟桌面版共用）。AI 搜尋走
        <b> ai_bridge.py</b> 呼叫 file_search_app 既有的
        <b> StickyNoteService / AIDescriptionService</b>——組 prompt、呼叫 Provider、解析回應，
        設定與用量計數也跟桌面版共用。<br />
        技術棧：Vite + React 19 + TypeScript + Tailwind 4 · Fastify · TanStack Query。
      </footer>

      {dialog && (
        <NoteDialog
          note={dialog.kind === 'open' ? dialog.note : null}
          initialMode={dialog.kind === 'new' ? 'new' : 'view'}
          knownTags={knownTags}
          defaultTag={defaultTag}
          onClose={closeDialog}
          onPrev={openIndex > 0 ? () => goToOffset(-1) : undefined}
          onNext={openIndex >= 0 && openIndex < shown.length - 1 ? () => goToOffset(1) : undefined}
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
      {batchTag && (
        <BatchTagDialog notes={list} knownTags={knownTags} onClose={() => setBatchTag(false)} />
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
      {thesisSeed && (
        <ThesisSeedDialog
          onClose={() => setThesisSeed(false)}
          onDone={() => {
            setThesisSeed(false)
            setAiResult(null)
            qc.invalidateQueries({ queryKey: ['notes'] })
          }}
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
      {trashOpen && (
        <TrashDialog
          onClose={() => {
            setTrashOpen(false)
            setAiResult(null) // 復原可能讓便利貼重新出現，AI 搜尋命中清單就不保證對得上了
          }}
        />
      )}
      {historyOpen && (
        <HistoryDialog
          onClose={() => {
            setHistoryOpen(false)
            setAiResult(null) // 還原可能整份換掉，AI 搜尋命中清單就對不上了
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
      {settingsOpen !== null && (
        <GlobalSettingsDialog
          initialTab={settingsOpen}
          onClose={() => setSettingsOpen(null)}
        />
      )}
      <ScrollButtons />
    </div>
  )
}
