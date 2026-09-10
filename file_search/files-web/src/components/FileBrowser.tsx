import { useEffect, useState } from 'react'
import { ArrowUp, File, Folder, HardDrive } from 'lucide-react'
import { useBrowse } from '../hooks/useIndexes'
import { humanSize } from '../lib/format'
import { getLastDir, setLastDir } from '../lib/lastDir'

/**
 * 選檔／選資料夾面板——瀏覽本機資料夾。桌面版用的是作業系統原生視窗；網頁
 * 拿不到本機絕對路徑，所以由後端 /browse 逐層列目錄，這裡呈現。
 * 只負責「選出一個路徑」，不做任何寫入。
 *
 * mode='file'：挑一個檔案（單擊選取、雙擊直接送出）。
 * mode='dir' ：挑一個資料夾——目前所在的目錄就是選取結果，只列子資料夾。
 */
export function FileBrowser({
  mode = 'file',
  onPick,
  onPickImmediate,
}: {
  mode?: 'file' | 'dir'
  /** 選取變化（含清空）時通知父層。dir 模式：每次換目錄回報目前目錄路徑。 */
  onPick: (path: string | null) => void
  /** file 模式：雙擊檔案＝直接送出。 */
  onPickImmediate?: (path: string) => void
}) {
  const [cwd, setCwd] = useState(getLastDir())
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const { data, isLoading, isError, error } = useBrowse(cwd)

  useEffect(() => {
    if (!data) return
    if (data.path) setLastDir(data.path)
    if (mode === 'dir') onPick(data.path || null)
  }, [data, mode, onPick])

  const go = (dir: string) => {
    setCwd(dir)
    setSelected(null)
    setQuery('')
    if (mode === 'file') onPick(null)
  }

  const q = query.trim().toLowerCase()
  const dirs = q ? (data?.dirs ?? []).filter((d) => d.name.toLowerCase().includes(q)) : data?.dirs ?? []
  const files = q ? (data?.files ?? []).filter((f) => f.name.toLowerCase().includes(q)) : data?.files ?? []
  const choose = (path: string) => {
    const next = selected === path ? null : path
    setSelected(next)
    onPick(next)
  }

  return (
    <div className="fb">
      <div className="fb-path">
        <button
          type="button"
          className="btn sm"
          onClick={() => data && go(data.parent ?? '')}
          disabled={!data || data.parent === null}
          title="上一層"
        >
          <ArrowUp size={14} aria-hidden /> 上一層
        </button>
        <span className="cwd mono">{data?.path || '本機磁碟機'}</span>
      </div>

      {data?.quick && data.quick.length > 0 && (
        <div className="fb-quick">
          {data.quick.map((qd) => (
            <button
              key={qd.path}
              type="button"
              className={`fb-quick-chip${data.path === qd.path ? ' on' : ''}`}
              onClick={() => go(qd.path)}
              title={qd.path}
            >
              {qd.name}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <p className="fb-empty mono">// 讀取中…</p>
      ) : isError ? (
        <p className="fb-empty mono err">// 讀不到這個資料夾：{error?.message}</p>
      ) : !data ? null : data.path === '' ? (
        <div className="fb-drives">
          {data.dirs.length === 0 && <p className="fb-empty mono">// 找不到任何磁碟機</p>}
          {data.dirs.map((d) => (
            <button key={d.path} type="button" className="btn" onClick={() => go(d.path)}>
              <HardDrive size={15} aria-hidden /> {d.name}
            </button>
          ))}
        </div>
      ) : (
        <>
          {(data.dirs.length > 0 || data.files.length > 0) && (
            <div className="fb-search-row">
              <input
                type="search"
                className="bd-search"
                value={query}
                placeholder="搜尋這裡的檔名、資料夾名…"
                onChange={(e) => setQuery(e.target.value)}
              />
              {q && (
                <span className="fb-search-count mono">
                  符合 {dirs.length + files.length} / {data.dirs.length + data.files.length}
                </span>
              )}
            </div>
          )}

          <div className="fb-list">
            {dirs.length === 0 && (mode === 'dir' || files.length === 0) && (
              <p className="fb-empty mono">
                {q
                  ? '// 沒有符合的項目'
                  : mode === 'dir'
                    ? '// 這裡沒有子資料夾'
                    : '// 這個資料夾是空的'}
              </p>
            )}
            {dirs.map((d) => (
              <button
                key={d.path}
                type="button"
                className="fb-item dir"
                onClick={() => go(d.path)}
              >
                <Folder size={15} aria-hidden />
                <span className="fb-name">{d.name}</span>
              </button>
            ))}
            {mode === 'file' &&
              files.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  className={`fb-item${selected === f.path ? ' on' : ''}`}
                  onClick={() => choose(f.path)}
                  onDoubleClick={() => onPickImmediate?.(f.path)}
                >
                  <File size={15} aria-hidden />
                  <span className="fb-name">{f.name}</span>
                  <span className="fb-size mono">{humanSize(f.size)}</span>
                </button>
              ))}
          </div>
          {data.truncated && (
            <p className="fb-trunc mono">// 這個資料夾項目太多，只列出前面一部分</p>
          )}
        </>
      )}
    </div>
  )
}
