import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { host } from '../lib/api'

/**
 * 「全域設定 → Discord 通知」——牆的 Discord 通知（訪客造訪／離開、到期鬧鐘、總匯報…）要送到哪個
 * webhook。以前寫死在 Node-RED，現在在這裡填，Node-RED 每 2 分鐘來讀一次（/api/host/notify-config）。
 * webhook 網址等同密碼：畫面上只顯示遮罩後的樣子，完整網址不會送回瀏覽器；只有主機本機看得到這個分頁。
 */
export function DiscordSettings() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['host-discord'], queryFn: host.getDiscord })
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState('')

  const save = useMutation({
    mutationFn: (url: string) => host.setDiscord(url),
    onSuccess: (r, url) => {
      qc.setQueryData(['host-discord'], r)
      setDraft('')
      setMsg(url ? '已儲存。Node-RED 下次讀取（最多 2 分鐘）後就會改用這個 webhook。' : '已清除。')
    },
  })
  const test = useMutation({
    mutationFn: host.testDiscord,
    onSuccess: () => setMsg('已送出測試訊息，去 Discord 頻道看看有沒有收到。'),
  })

  if (isLoading) return <p className="hint">讀取中…</p>
  if (error) return <p className="err">讀不到設定：{error.message}</p>

  return (
    <div className="form discord-settings">
      <p className="hint">
        牆的 Discord 通知（訪客造訪／離開、到期鬧鐘、總匯報）會送到這個 webhook。Node-RED 每 2 分鐘來讀一次，
        不用再進 Node-RED 改流程。webhook 等同密碼——這裡只顯示遮罩後的樣子，也只有在主機本機才看得到這個分頁。
      </p>

      <div className="discord-current">
        <span className="discord-dot" data-on={data?.configured ? '1' : '0'} aria-hidden />
        {data?.configured ? (
          <>
            目前設定：<code>{data.masked}</code>
          </>
        ) : (
          '還沒設定 webhook——Node-RED 的牆通知目前不會送出'
        )}
      </div>

      <label>
        {data?.configured ? '換成新的 webhook' : 'Discord webhook 網址'}
        <span className="hint">Discord 頻道 → 編輯頻道 → 整合 → Webhook → 新增 → 複製網址，貼在這裡。</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          placeholder="https://discord.com/api/webhooks/…"
          onChange={(e) => {
            setDraft(e.target.value)
            setMsg('')
          }}
        />
      </label>

      <div className="discord-actions">
        <button type="button" className="btn sm" disabled={!draft.trim() || save.isPending} onClick={() => save.mutate(draft)}>
          {save.isPending ? '儲存中…' : '儲存'}
        </button>
        <button
          type="button"
          className="btn sm ghost"
          disabled={!data?.configured || test.isPending}
          onClick={() => {
            setMsg('')
            test.mutate()
          }}
        >
          {test.isPending ? '發送中…' : '發送測試訊息'}
        </button>
        {data?.configured && (
          <button type="button" className="btn sm danger" disabled={save.isPending} onClick={() => save.mutate('')}>
            清除
          </button>
        )}
      </div>

      {msg && <p className="discord-msg">{msg}</p>}
      {save.error && <p className="err">{save.error.message}</p>}
      {test.error && <p className="err">{test.error.message}</p>}
    </div>
  )
}
