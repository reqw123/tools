import { lazy, Suspense, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { session } from '../lib/api'
import { readAuthorName, saveAuthorName } from '../lib/identity'

// 動態載入——LoginLogo3D 拉進整包 three.js（未壓縮前光函式庫本身就多出
// ~600KB），不能讓它變成主 bundle 的一部分，不然變成每個人（含已登入、
// 完全用不到這個裝飾功能的人）每次都要多下載這包，違背「關掉時完全不佔
// 資源」的本意。lazy() 讓 Vite 把它切成獨立 chunk，只有這裡真的 render
// 出來（loginLogo3d===true）才會去抓。
const LoginLogo3D = lazy(() => import('./LoginLogo3D').then((m) => ({ default: m.LoginLogo3D })))

// 跟 server/people.ts 的 MIN_PIN 同一個數字——前端先擋一次，不用等 server 回錯
// 才知道太短，也少打一次注定失敗的登入請求。
const PIN_MIN_LEN = 4

/**
 * 區網共用模式的密碼牆。伺服器要密碼、這個瀏覽器還沒登入時，App 只 render 這個。
 * 登入成功 → cookie 由 server 種下 → 清掉所有 query 讓牆重抓。
 *
 * **share_session 現在是 session cookie**（沒有 maxAge）——瀏覽器關掉就失效，
 * 所以每次重新連線都會再看到這個畫面，不是只有第一次。
 *
 * 順便問「你的名字」＋PIN——純顯示用，不是帳號。**一般模式**下可以留空
 * （匿名，每次都能重新選）；**一旦填了名字就一定要順便設 PIN**，設定後這組
 * 名字＋PIN 就固定了，牆上沒有「改名字」「換 PIN」的功能，別人也沒辦法臨時
 * 冒用你的名字——想換要請牆主在 `/host` 解除保護。見 server/people.ts。
 *
 * **開放模式**（`openAccess`，host 在 /host 開的「先不要密碼」）不顯示共用
 * 密碼欄位，但名字＋PIN 改成**必填**、不能留空匿名——免密碼是為了方便，
 * 不代表連身分驗證／防冒充都一起省掉，見 server/share.ts 的 shareAuthHook。
 *
 * **`loginLogo3d`**（host 在 /host 開的「登入畫面 3D Logo」）為 true 才會
 * mount `<LoginLogo3D/>`——關掉時完全不會出現在畫面／不會發出任何請求，見
 * 該元件開頭的說明。純裝飾，跟登入邏輯無關。
 */
export function PasswordGate({
  openAccess,
  loginLogo3d,
  onPass,
}: {
  openAccess: boolean
  loginLogo3d: boolean
  onPass: () => void
}) {
  const qc = useQueryClient()
  const [pw, setPw] = useState('')
  const [name, setName] = useState(readAuthorName)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // 一般模式：名字有填就一定要 PIN（可以整組留空＝匿名）。
  // 開放模式：名字本身就是必填（不能匿名），PIN 因此也一定要有。
  // 跟 server（people.ts 的 claimOrVerify／share.ts 的 openAccess 分支）同一條
  // 規則，前端先擋一次，不用等 server 回錯才知道，也避免打一次沒意義的請求。
  const nameMissing = openAccess && name.trim().length === 0
  const nameNeedsPin = name.trim().length > 0 && pin.trim().length === 0
  const pinTooShort = name.trim().length > 0 && pin.trim().length > 0 && pin.trim().length < PIN_MIN_LEN
  const canSubmit = !busy && !nameMissing && !nameNeedsPin && !pinTooShort && (openAccess || !!pw)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setErr('')
    try {
      await session.login(openAccess ? '' : pw, name, pin)
      saveAuthorName(name) // 只有登入成功才存——PIN 打錯的話不要留下沒被接受的名字
      await qc.invalidateQueries()
      onPass()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : '登入失敗')
      setBusy(false)
    }
  }

  return (
    <div className="pw-gate">
      <form className="pw-card" onSubmit={submit}>
        {loginLogo3d && (
          <Suspense fallback={<div className="login-logo-3d login-logo-3d-canvas" aria-hidden />}>
            <LoginLogo3D />
          </Suspense>
        )}
        <h1 className="brush">便利貼牆</h1>
        <p className="dim">
          {openAccess
            ? '這面牆目前開放模式，不需要密碼——但要輸入名字＋PIN 才能進來，用來認人、避免有人冒充別人。'
            : '這面牆需要密碼才能進入。跟牆主人拿。'}
        </p>
        {!openAccess && (
          <input
            type="password"
            autoFocus
            placeholder="共用密碼"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            disabled={busy}
          />
        )}
        <input
          type="text"
          autoFocus={openAccess}
          placeholder={
            openAccess
              ? '你的名字（必填；填了就要設 PIN，之後不能再改）'
              : '你的名字（可留空＝匿名；填了就要設 PIN，之後不能再改）'
          }
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <input
          type="password"
          inputMode="numeric"
          placeholder={`PIN（至少 ${PIN_MIN_LEN} 碼；填了名字就一定要設，設定後固定不能改）`}
          maxLength={20}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          disabled={busy}
        />
        {name.trim().length > 0 && (
          <p className="dim pw-hint pw-hint-warn">
            ⚠️ 這組名字＋PIN 一旦設定就固定了，牆上沒有「改名字」「換 PIN」的功能——
            <b>PIN 忘記的話你自己救不回這個名字</b>，只有牆主能在 /host 後台解除保護，
            在那之前這個名字你進不來，請務必記住。
          </p>
        )}
        {nameMissing ? (
          <p className="dim pw-hint">開放模式仍要輸入名字＋PIN 才能進——用來認人、避免有人冒用別人的名字發文。</p>
        ) : nameNeedsPin ? (
          <p className="dim pw-hint">填了名字要順便設 PIN 才能進。</p>
        ) : (
          pinTooShort && <p className="dim pw-hint">PIN 太短——至少要 {PIN_MIN_LEN} 碼。</p>
        )}
        {err && <p className="err">{err}</p>}
        <button className="btn" type="submit" disabled={!canSubmit}>
          {busy ? '進入中…' : '進入'}
        </button>
      </form>
    </div>
  )
}
