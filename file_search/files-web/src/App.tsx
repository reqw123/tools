import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Entry } from './lib/api'
import { api } from './lib/api'
import { useDeleteEntry, useIndex, useIndexList, useUpdateEntry } from './hooks/useIndexes'
import { useExists } from './hooks/useExists'
import { hasDesktopWall } from './lib/desktopWall'
import { getLastIndex, setLastIndex } from './lib/lastIndex'
import { Toolbar, type Group, type Sort, type View } from './components/Toolbar'
import { Preamble } from './components/Preamble'
import { DocView } from './components/DocView'
import { EntryList } from './components/EntryList'
import { AddEntryDialog } from './components/AddEntryDialog'
import { BatchImportDialog } from './components/BatchImportDialog'
import { BatchDescribeDialog } from './components/BatchDescribeDialog'
import { BatchDeleteDialog } from './components/BatchDeleteDialog'
import { BatchRecategorizeDialog } from './components/BatchRecategorizeDialog'
import { AiSettingsDialog } from './components/AiSettingsDialog'
import { ImportIndexDialog } from './components/ImportIndexDialog'
import { downloadIndexMarkdown } from './lib/exportIndex'

// wallpaper-app 重開時用 `?floated=<JSON 陣列>` 把「已經是懸浮視窗」的項目
// path 帶回來（見 wallpaper-app/main.js 的 currentUrl()），讓 floatedPaths
// 初始化時就把它們濾掉，不然重開後同一筆會主清單＋懸浮視窗兩邊都看得到。
// restorePinnedWindows() 只還原懸浮視窗，不會告訴主牆網頁這件事。
// 壞掉／沒有這個參數就回空集合，絕不因此讓整頁掛掉。
function parseFloatedPaths(): Set<string> {
  try {
    const raw = new URLSearchParams(location.search).get('floated')
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

const UNCATEGORIZED = '\x00uncat'

export function App() {
  const { data: indexes, isLoading: loadingList, isError: listError } = useIndexList()
  const [picked, setPicked] = useState<string | null>(null)

  // 目前開哪一份用推導的（不用 effect）：使用者選過且還在 → 用它；
  // 否則上次開的 → 還在就用它；再否則清單第一份。
  const index = useMemo(() => {
    if (!indexes || indexes.length === 0) return null
    if (picked && indexes.includes(picked)) return picked
    const last = getLastIndex()
    return last && indexes.includes(last) ? last : indexes[0]
  }, [indexes, picked])

  const { data: payload, isLoading: loadingIndex, isError: indexError, error } = useIndex(index)
  const { stats, checking, request, recheckAll } = useExists()

  // wallpaper-app 專屬手勢——網頁版（沒有 window.desktopWall）完全不會走到
  // 這個功能。canFloat 只需要判斷一次：這個 API 存不存在在整個 session
  // 期間不會變。
  const [canFloat] = useState(hasDesktopWall)
  // 拖出去變懸浮視窗的項目——列表上要跟著隱藏，不然同一筆兩邊都看得到。
  // 用 path 就夠（不用連 indexName 一起放進 Set），因為畫面上任何時刻只
  // 看得到一份索引集的列表，同一個 path 不管出現在哪份索引都該濾掉。
  const [floatedPaths, setFloatedPaths] = useState<Set<string>>(() => parseFloatedPaths())

  useEffect(() => {
    if (!canFloat) return
    window.desktopWall?.onEntryUnpinned(({ path }) => {
      setFloatedPaths((s) => {
        if (!s.has(path)) return s
        const next = new Set(s)
        next.delete(path)
        return next
      })
    })
  }, [canFloat])

  const onPin = useCallback(
    (e: Entry, rect: DOMRect) => {
      if (!index) return
      window.desktopWall?.pinEntry(
        { indexName: index, path: e.path },
        { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      )
      setFloatedPaths((s) => new Set(s).add(e.path))
    },
    [index],
  )

  const [view, setView] = useState<View>('list')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [folder, setFolder] = useState('')
  const [group, setGroup] = useState<Group>('none')
  const [sort, setSort] = useState<Sort>('serial')
  const [toast, setToast] = useState('')
  const [dialog, setDialog] = useState<
    'add' | 'import' | 'describe' | 'recategorize' | 'delete' | 'ai' | 'import-index' | null
  >(null)

  const deferredQuery = useDeferredValue(query)
  const entries = useMemo(() => payload?.entries ?? [], [payload])

  const pickIndex = useCallback((name: string) => {
    setPicked(name)
    setLastIndex(name)
    setQuery('')
    setCategory('')
    setFolder('')
    window.scrollTo({ top: 0 })
  }, [])

  const categories = useMemo(() => {
    const set = new Set<string>()
    let hasUncat = false
    for (const e of entries) {
      if (e.category) set.add(e.category)
      else hasUncat = true
    }
    const list = ['', ...[...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'))]
    if (hasUncat) list.push(UNCATEGORIZED)
    return list
  }, [entries])

  const folders = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) set.add(e.dir)
    return ['', ...[...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'))]
  }, [entries])

  const shown = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    let out: Entry[] = entries.filter((e) => {
      if (category === UNCATEGORIZED) {
        if (e.category) return false
      } else if (category && e.category !== category) {
        return false
      }
      if (folder && e.dir !== folder) return false
      if (q) {
        const hay = `${e.serial}\n${e.name}\n${e.category}\n${e.description}\n${e.path}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    if (sort === 'name') {
      out = [...out].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant') || a.serial - b.serial)
    }
    // 拖出去變懸浮視窗的項目從列表拿掉——懸浮視窗那邊（FocusedEntry）自己顯示。
    return floatedPaths.size ? out.filter((e) => !floatedPaths.has(e.path)) : out
  }, [entries, category, folder, deferredQuery, sort, floatedPaths])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2200)
  }, [])

  // AddEntryDialog 的分類 datalist 用的原始分類字串（沒有 UNCATEGORIZED 那個哨兵）。
  const rawCategories = useMemo(
    () =>
      [...new Set(entries.filter((e) => e.category).map((e) => e.category))].sort((a, b) =>
        a.localeCompare(b, 'zh-Hant'),
      ),
    [entries],
  )

  const del = useDeleteEntry(index)
  const onDelete = useCallback(
    (e: Entry) => {
      del.mutate(
        { serial: e.serial, path: e.path },
        {
          onSuccess: () => flash('已從索引移除（實體檔案保留）'),
          onError: (err: Error) => flash(err.message || '移除失敗'),
        },
      )
    },
    [del, flash],
  )
  const deletingPath = del.isPending ? (del.variables?.path ?? null) : null

  const edit = useUpdateEntry(index)
  const onEdit = useCallback(
    (e: Entry, v: { category: string; description: string }) => {
      edit.mutate(
        { serial: e.serial, path: e.path, category: v.category, description: v.description },
        {
          onSuccess: () => flash('已更新這一列索引'),
          onError: (err: Error) => flash(err.message || '更新失敗'),
        },
      )
    },
    [edit, flash],
  )
  const editingPath = edit.isPending ? (edit.variables?.path ?? null) : null
  const editError = edit.isError ? (edit.error?.message ?? '更新失敗') : null

  const onCopy = useCallback(
    (path: string) => {
      navigator.clipboard?.writeText(path).then(
        () => flash('已複製路徑'),
        () => flash('複製失敗'),
      )
    },
    [flash],
  )

  const onOpen = useCallback(
    (path: string, select: boolean) => {
      api.open(path, select).then(
        () => flash(select ? '已開啟所在資料夾' : '已開啟檔案'),
        (e: Error) => flash(e.message || '開啟失敗'),
      )
    },
    [flash],
  )

  const onRecheck = useCallback(() => {
    recheckAll(shown.map((e) => e.path))
    flash('重新檢查中…')
  }, [recheckAll, shown, flash])

  const onExportIndex = useCallback(() => {
    if (!index || !payload) return
    downloadIndexMarkdown(index, payload.raw)
  }, [index, payload])

  const categoryCount = useMemo(
    () => new Set(entries.filter((e) => e.category).map((e) => e.category)).size,
    [entries],
  )

  const missingCount = useMemo(
    () => shown.reduce((n, e) => n + (stats[e.path] && !stats[e.path].exists ? 1 : 0), 0),
    [shown, stats],
  )

  return (
    <div className="page">
      <div className="backdrop" aria-hidden />

      <header className="hero">
        <p className="eyebrow mono">Index Wall · file_search_app</p>
        <h1>檔案索引</h1>
        <p className="lede">
          桌面工具「檔案快速搜尋」的 <code>indexes/*.md</code>{' '}
          手動索引，一次看一份。可加入 / 編輯 / 移除項目、批次匯入資料夾、
          批次補說明（可用 AI）、批次刪除（都只動 <code>.md</code>，不碰實體檔案）；
          AI 全文搜尋等進階功能仍在桌面版。
        </p>
      </header>

      <Toolbar
        indexes={indexes ?? []}
        index={index}
        onIndex={pickIndex}
        view={view}
        onView={setView}
        query={query}
        onQuery={setQuery}
        categories={categories.map((c) => (c === UNCATEGORIZED ? '未分類' : c))}
        category={category === UNCATEGORIZED ? '未分類' : category}
        onCategory={(v) => setCategory(v === '未分類' ? UNCATEGORIZED : v)}
        folders={folders}
        folder={folder}
        onFolder={setFolder}
        group={group}
        onGroup={setGroup}
        sort={sort}
        onSort={setSort}
        total={entries.length}
        shown={shown.length}
        categoryCount={categoryCount}
        onRecheck={onRecheck}
        checking={checking}
        onAdd={() => setDialog('add')}
        onBatchImport={() => setDialog('import')}
        onBatchDescribe={() => setDialog('describe')}
        onBatchRecategorize={() => setDialog('recategorize')}
        onBatchDelete={() => setDialog('delete')}
        onOpenAiSettings={() => setDialog('ai')}
        onImportIndex={() => setDialog('import-index')}
        onExportIndex={onExportIndex}
      />

      <main className="wrap">
        {loadingList ? (
          <p className="notice mono">// 讀取索引集清單…</p>
        ) : listError ? (
          <p className="notice err mono">// 讀不到索引集清單（後端有啟動嗎？）</p>
        ) : !indexes || indexes.length === 0 ? (
          <p className="notice mono">// indexes/ 底下沒有任何 .md 索引集</p>
        ) : loadingIndex ? (
          <p className="notice mono">// 載入「{index}」…</p>
        ) : indexError ? (
          <p className="notice err mono">// 載入失敗：{error?.message}</p>
        ) : payload ? (
          view === 'doc' ? (
            <DocView markdown={payload.raw} />
          ) : (
          <>
            <Preamble markdown={payload.preamble} />

            {entries.length === 0 ? (
              <p className="notice mono">// 這份索引集還沒有項目</p>
            ) : shown.length === 0 ? (
              <p className="notice mono">// 沒有符合目前條件的項目</p>
            ) : (
              <EntryList
                entries={shown}
                group={group}
                stats={stats}
                onVisible={request}
                onOpen={onOpen}
                onCopy={onCopy}
                onEdit={onEdit}
                editingPath={editingPath}
                editError={editError}
                categories={rawCategories}
                onDelete={onDelete}
                deletingPath={deletingPath}
                onPin={canFloat ? onPin : undefined}
              />
            )}

            <p className="tail mono">
              {missingCount > 0 && <span className="tail-miss">遺失 {missingCount} 項 · </span>}
              共 {shown.length} 項
              {payload.skipped > 0 && ` · 已略過 ${payload.skipped} 列無法解析的內容`}
            </p>
          </>
          )
        ) : null}
      </main>

      <footer className="colophon mono">
        資料來源：<b>indexes/*.md</b>（跟桌面版共用）。 解析與寫入移植自
        <b> IndexRepository</b>（<b>_ROW_RE</b> / <b>append_row</b> / <b>remove_rows_by_occurrences</b>）。
        「開啟檔案／資料夾」「選檔視窗」由本機後端提供，只綁 localhost。
      </footer>

      {dialog === 'add' && index && (
        <AddEntryDialog
          indexName={index}
          categories={rawCategories}
          onClose={() => setDialog(null)}
          onAdded={() => {
            setDialog(null)
            flash('已加入索引')
          }}
        />
      )}
      {dialog === 'import' && index && (
        <BatchImportDialog
          indexName={index}
          existingPaths={entries.map((e) => e.path)}
          categories={rawCategories}
          onClose={() => setDialog(null)}
          onDone={(added) => {
            setDialog(null)
            flash(added > 0 ? `已匯入 ${added} 筆` : '沒有新的可匯入（都已在索引中）')
          }}
        />
      )}
      {dialog === 'describe' && index && (
        <BatchDescribeDialog
          indexName={index}
          onClose={() => setDialog(null)}
          onDone={(n) => {
            setDialog(null)
            flash(`已補上 ${n} 筆說明`)
          }}
        />
      )}
      {dialog === 'recategorize' && index && (
        <BatchRecategorizeDialog
          indexName={index}
          entries={entries}
          categories={rawCategories}
          onClose={() => setDialog(null)}
          onDone={(updated) => {
            setDialog(null)
            flash(`已更新 ${updated} 筆的分類`)
          }}
        />
      )}
      {dialog === 'delete' && index && (
        <BatchDeleteDialog
          indexName={index}
          entries={entries}
          onClose={() => setDialog(null)}
          onDone={(removed) => {
            setDialog(null)
            flash(`已從索引移除 ${removed} 筆（實體檔案保留）`)
          }}
        />
      )}
      {dialog === 'ai' && <AiSettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'import-index' && (
        <ImportIndexDialog
          existingNames={indexes ?? []}
          onClose={() => setDialog(null)}
          onDone={(name) => {
            setDialog(null)
            pickIndex(name)
            flash(`已匯入「${name}」`)
          }}
        />
      )}

      {toast && <div className="toast mono">{toast}</div>}
    </div>
  )
}
