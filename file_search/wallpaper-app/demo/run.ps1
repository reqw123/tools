#requires -Version 5.1
<#
  桌面牆「產品展示」腳本——用真實滑鼠與鍵盤，把整段流程自動走一遍：

    開啟離線牆 → 新增便利貼 → 拖出去懸浮 → 切到索引牆 → 新增索引集 → 匯入資料夾
    → 預覽影片 → 懸浮 → 拖拉視窗邊界擴大 → 播放 N 秒後停止 → 按右上角 ✕ 結束程式

  執行時滑鼠與鍵盤會被接管約一分鐘，請不要碰。結束後預設會把這次新增的資料清掉
  （便利貼、索引集、懸浮視窗紀錄；只動這次產生、且精確比對得到的項目），要保留加 -NoCleanup。
  詳見 README.md（含「這是重播不是自主操作」的說明）。

  用法：  powershell -ExecutionPolicy Bypass -File wallpaper-app\demo\run.ps1
          powershell -ExecutionPolicy Bypass -File wallpaper-app\demo\run.ps1 -PlaySeconds 3 -NoCleanup
#>
param(
  [string]$ImportDir = 'C:\Users\homec\OneDrive\圖片\貓咪\自行拍攝\影片',   # 要匯入的資料夾
  [string]$VideoFile = 'VID20260904143024.mp4',                            # 要預覽／播放的影片（要在 ImportDir 底下）
  [int]$PlaySeconds = 4,                                                    # 播放幾秒後停止
  [string]$IndexName = '貓咪自拍影片',                                      # 這次新建的索引集名稱（同時當匯入的分類）
  [string]$NoteTitle = 'AI 自動化展示',                                     # 展示用便利貼的標題
  [switch]$NoCleanup,                                                       # 跑完不要清掉新增的資料
  [switch]$KeepAppOnFailure                                                 # 失敗時讓桌面版留著開著、不清理（除錯用）
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\cdp.ps1"

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path            # file_search\
$IDX = Join-Path $Root 'indexes'
$OutDir = Join-Path $PSScriptRoot 'out'; New-Item -ItemType Directory -Force $OutDir | Out-Null
$log = Join-Path $OutDir 'run.log'; Set-Content $log '' -Encoding UTF8
$script:T0 = Get-Date
function Log([string]$m) { $t = '{0,6:N1}s' -f ((Get-Date) - $script:T0).TotalSeconds; "[$t] $m" | Tee-Object -FilePath $log -Append }
function Hold([int]$ms) { Start-Sleep -Milliseconds $ms }                 # 讓觀眾看清楚的停頓
function Js([string]$s) { ($s | ConvertTo-Json -Compress) }               # 字串 → JS 字面值（含跳脫）
$wall = { Wall-Target }
$floatEntry = { Float-Target 8788 }
$warnings = @()

# ── 事前檢查 ────────────────────────────────────────────────────────────────
if (@(Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*wallpaper-app*' }).Count -gt 0) { throw '桌面牆已經開著，請先結束它（右上角 ✕）再執行。' }
if (-not (Test-Path -LiteralPath $ImportDir -PathType Container)) { throw "找不到資料夾：$ImportDir" }
if (-not (Test-Path -LiteralPath (Join-Path $ImportDir $VideoFile))) { throw "找不到影片：$(Join-Path $ImportDir $VideoFile)" }
if (Test-Path -LiteralPath (Join-Path $IDX "$IndexName.md")) { throw "索引集 $IndexName.md 已存在，請換一個 -IndexName（腳本不會覆蓋既有的索引集）。" }
$settingsPath = Join-Path $env:APPDATA 'wallpaper-app\settings.json'
$origWall = if (Test-Path $settingsPath) { (Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json).wall } else { 'sticky' }
$runStart = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$snap87 = $null; $snap88 = $null; $restored87 = $false; $failure = $null
function App-Running { @(Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*wallpaper-app*' }).Count -gt 0 }
function Quit-App { $qt = Cdp-Targets | Where-Object { $_.url -match 'quit-button' } | Select-Object -First 1; if ($qt) { [void](Cdp-Eval $qt 'window.dwQuit.quit()') } }   # 不用滑鼠的關閉（安全網用）

try {
# ── 0. 開啟離線牆 ───────────────────────────────────────────────────────────
Log '開啟離線牆（桌面版）'
Start-Process -FilePath 'npm.cmd' -ArgumentList 'start', '--', '--remote-debugging-port=9333' -WorkingDirectory (Join-Path $Root 'wallpaper-app') -WindowStyle Hidden
Wait-Cond { (Wall-Target) -and (Find-Rect (Wall-Target) 'T(".coll-tab","生活")') } 60000 '牆載入完成'
Hold 500
Log '牆已出現'
$snap87 = Get-Storage (Wall-Target)         # 記下便利貼牆的介面記憶，結束前還原

# ── 1. 新增便利貼 ─────────────────────────────────────────────────────────────
[void](Click-Elem $wall 'T(".coll-tab","生活")');                  Log '切到「生活」分頁'
[void](Click-Elem $wall 'T("button","新增便利貼")');               Log '按「新增便利貼」'
Type-Into $wall 'I[0]' $NoteTitle 30
Hold 150
Type-Into $wall 'I[1]' '展示' 30 -SelectAll
Type-Into $wall 'D.querySelector("textarea")' '這張便利貼是 AI 用真實滑鼠與鍵盤自己新增的' 25
Log '填好標題／標籤／內容'
Hold 400
[void](Click-Elem $wall 'X(".sheet[role=dialog] button","新增")');  Log '按「新增」送出'
Wait-Cond { (Get-Content (Join-Path $IDX '.sticky_notes.json') -Raw -Encoding UTF8) -match [regex]::Escape($NoteTitle) } 8000 '便利貼寫入檔案'
$note = Wait-Rect $wall ('[...document.querySelectorAll(".note")].find(n => norm(n).includes(' + (Js $NoteTitle) + '))') 8000
Log '✔ 便利貼新增成功（已寫入檔案，畫面上可見）'
[void](Shot 'r01-note-added'); Hold 700

# ── 2. 把便利貼拖出去懸浮 ───────────────────────────────────────────────────
Drag-Mouse ([int]($note.l + $note.w * 0.4)) ([int]($note.t + $note.h * 0.78)) 6 ([int]($note.t + $note.h * 0.78)) 650
Wait-Cond { Float-Target 8787 } 8000 '便利貼懸浮視窗出現'
Log '✔ 便利貼已拖出去，變成懸浮視窗'
Restore-Storage (Wall-Target) $snap87; $restored87 = $true     # 靜默還原便利貼牆的介面記憶（含「生活/研究生」分頁；非畫面操作，不影響現在畫面）
Hold 700
[void](Shot 'r02-note-floating')

# ── 3. 切到索引牆 ─────────────────────────────────────────────────────────────
Press-Combo @(0x10, 0x43)
Wait-Cond { (Wall-Target).url -match ':8788/' } 10000 '切到索引牆'
Wait-Rect $wall 'document.querySelector("button[title^=\"新增索引集\"]")' 10000 | Out-Null
Log '✔ 已切換到索引牆（Shift+C）'
$snap88 = Get-Storage (Wall-Target)         # 記下索引牆的介面記憶（此時還沒動過任何東西），結束前還原
Hold 600

# ── 4. 建立索引集 ＋ 匯入資料夾 ──────────────────────────────────────────────
[void](Click-Elem $wall 'document.querySelector("button[title^=\"新增索引集\"]")'); Log '按「新增索引集」'
Type-Into $wall '[...document.querySelectorAll(".modal input")].filter(vis)[0]' $IndexName 30
Hold 250
[void](Click-Elem $wall 'X(".modal button","建立")')
Wait-Cond { Test-Path -LiteralPath (Join-Path $IDX "$IndexName.md") } 8000 '索引集檔案建立'
Log "✔ 索引集「$IndexName」已建立"
Hold 500
[void](Click-Elem $wall 'T("button","匯入資料夾")');                Log '按「匯入資料夾」'

# 檔案瀏覽器：從最接近的捷徑（下載／文件／家目錄）出發，一層一層點進目標資料夾
$homeDir = $env:USERPROFILE
$chip = @(@{ n = '下載'; p = "$homeDir\Downloads" }, @{ n = '文件'; p = "$homeDir\Documents" }, @{ n = '家目錄'; p = $homeDir }) |
  Where-Object { $ImportDir.StartsWith($_.p + '\', [StringComparison]::OrdinalIgnoreCase) } | Sort-Object { $_.p.Length } -Descending | Select-Object -First 1
if (-not $chip) { throw "匯入資料夾必須在 下載／文件／家目錄 底下（檔案瀏覽器的捷徑），目前是：$ImportDir" }
[void](Click-Elem $wall ('T(".fb-quick-chip",' + (Js $chip.n) + ')') -Fast)
foreach ($seg in $ImportDir.Substring($chip.p.Length).Trim('\').Split('\')) {
  [void](Click-Elem $wall ('X(".fb-item.dir .fb-name",' + (Js $seg) + ')') -Fast)
}
Wait-Cond { Cdp-Eval (Wall-Target) ('document.querySelector(".fb").textContent.includes(' + (Js $ImportDir) + ')') } 5000 '進入目標資料夾'
Hold 120
[void](Click-Elem $wall 'X(".modal button","下一步")' -Fast);         Log '選定資料夾 → 下一步'
[void](Click-Elem $wall 'T("label","包含子資料夾")' -Fast)
[void](Click-Elem $wall 'X(".bi-scan button","掃描")' -Fast);         Log '按「掃描」'
Wait-Rect $wall 'document.querySelector(".bi-result")' 30000 | Out-Null
$scan = Cdp-Eval (Wall-Target) '(() => { const e = document.querySelector(".bi-result"); return e ? e.textContent.replace(/\s+/g," ").trim() : ""; })()'
Log "✔ 掃描結果：$scan"
if ($scan -notmatch '掃到\s*(\d+)') { throw "讀不到掃描筆數：$scan" }
$expected = [int]$Matches[1]
Hold 450
Type-Into $wall 'document.querySelector("#bi-cat")' $IndexName 30
Hold 200
[void](Click-Elem $wall 'T(".modal-foot .btn.primary","匯入")');    Log '按「匯入」'
$pat = [regex]::Escape($ImportDir)
Wait-Cond { @(Select-String -LiteralPath (Join-Path $IDX "$IndexName.md") -Pattern $pat).Count -ge $expected } 20000 "匯入 $expected 筆寫入"
Log "✔ 已匯入 $expected 筆（索引檔已寫入）"
Hold 600
[void](Shot 'r03-imported')

# ── 5. 預覽影片 → 懸浮 → 擴大 → 播放 ────────────────────────────────────────
$stem = [IO.Path]::GetFileNameWithoutExtension($VideoFile)
Type-Into $wall 'P("input","搜尋檔名")' $stem 30
[void](Click-Elem $wall 'document.querySelector(".row .row-head")')
[void](Click-Elem $wall 'T(".row button","預覽內容")')
Wait-Rect $wall 'document.querySelector(".row video")' 10000 | Out-Null
Log '✔ 影片預覽已顯示'
Hold 800
[void](Click-Elem $wall 'document.querySelector(".row button[title=\"按一下變懸浮視窗\"]")')
Wait-Cond { Float-Target 8788 } 8000 '影片懸浮視窗出現'
Log '✔ 影片項目已變成懸浮視窗'
Hold 300
[void](Click-Elem $floatEntry 'document.querySelector(".row-head")' -Fast)
[void](Click-Elem $floatEntry 'T("button","預覽內容")' -Fast)
Wait-Rect $floatEntry 'document.querySelector("video")' 10000 | Out-Null
Hold 250

# 手動拖拉邊界擴大：抓視窗右上角，一次同時拉寬＋拉高（真人也是這樣拉的）；游標在最外緣角落會變成斜向縮放
$g = Cdp-Eval (Float-Target 8788) '({x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight})'
Log ("懸浮視窗原本大小 {0}×{1}" -f $g.w, $g.h)
$corner = $null; $cur = ''; $first = $true
foreach ($o in @(@(3, 2), @(2, 2), @(4, 3), @(2, 4))) {           # 角落熱區很小，依序試幾個相對位置，直到游標變成斜向縮放
  $tx = [int]($g.x + $g.w - $o[0]); $ty = [int]($g.y + $o[1])
  Move-Mouse $tx $ty $(if ($first) { 380 } else { 40 }); $first = $false; Hold 90
  $cur = [DemoCur]::Name()
  if ($cur -eq 'SIZENESW') { $corner = @($tx, $ty); break }
}
Log "游標在右上角變成：$cur"
if ($corner) { Drag-Mouse $corner[0] $corner[1] ($corner[0] + 340) ([int][math]::Max(40, $corner[1] - 220)) }
$g2 = Cdp-Eval (Float-Target 8788) '({x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight})'
if ($g2.w -le $g.w -and $g2.h -le $g.h) {                          # 角落沒抓到 → 改抓右緣＋上緣（各拖一次）
  Log '  角落沒拖動，改抓右緣＋上緣'
  $ex = [int]($g.x + $g.w - 1); $ey = [int]($g.y + $g.h * 0.5)
  Move-Mouse $ex $ey 300; Hold 80
  Drag-Mouse $ex $ey ($ex + 340) $ey
  $tx = [int]($g.x + $g.w * 0.4); $ty = [int]($g.y + 1)
  Move-Mouse $tx $ty 250; Hold 80
  Drag-Mouse $tx $ty $tx ([int][math]::Max(40, $g.y - 220))
  $g2 = Cdp-Eval (Float-Target 8788) '({x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight})'
}
Log ("✔ 拖拉後大小 {0}×{1}（原本 {2}×{3}）" -f $g2.w, $g2.h, $g.w, $g.h)
if ($g2.w -le $g.w -and $g2.h -le $g.h) { $warnings += '視窗沒有被拖大' }
Hold 300

# 播放 → N 秒 → 暫停（點影片畫面本身＝播放／暫停切換）
$vr = Wait-Rect $floatEntry 'document.querySelector("video")' 5000
Click-Human ([int]$vr.x) ([int]$vr.y) 450
$tPlay = Get-Date; Log "▶ 按下播放（預計 $PlaySeconds 秒後停止）"
Hold ([int]($PlaySeconds * 1000 / 2)); [void](Shot 'r04-playing')
$left = $PlaySeconds * 1000 - [int]((Get-Date) - $tPlay).TotalMilliseconds; if ($left -gt 0) { Hold $left }
Click-Human ([int]$vr.x) ([int]$vr.y) 60
$v = Cdp-Eval (Float-Target 8788) '(() => { const v = document.querySelector("video"); return {t: v.currentTime, paused: v.paused, ready: v.readyState, w: v.videoWidth, err: v.error ? v.error.code : 0, hevc: v.canPlayType("video/mp4; codecs=\"hvc1.1.6.L93.B0\"")}; })()'
Log ("⏸ 已暫停：paused={0}，影片時間 {1:N2} 秒，readyState={2}，畫面寬 {3}，錯誤碼 {4}，HEVC 支援={5}" -f $v.paused, $v.t, $v.ready, $v.w, $v.err, $(if ($v.hevc) { $v.hevc } else { '否' }))
if (-not $v.paused) { $warnings += '影片沒有停下來' }
if ($v.t -lt ($PlaySeconds - 1) -or $v.t -gt ($PlaySeconds + 2)) { $warnings += ("影片實際播放了 {0:N2} 秒，跟預期 {1} 秒差很多（可能是解碼器不支援這支影片的編碼，或緩衝太慢）" -f $v.t, $PlaySeconds) }
Hold 600; [void](Shot 'r05-paused')

# ── 6. 還原索引牆的介面記憶 → 按右上角叉叉結束 ─────────────────────────────────────────────────────
Restore-Storage (Wall-Target) $snap88
if (-not (Storage-Equal (Get-Storage (Wall-Target)) $snap88)) { $warnings += '索引牆的介面記憶沒有完全還原' } else { Log '✔ 介面記憶已還原（索引牆）' }
$q = (App-Windows | Where-Object { $_ -match ' 64 64 ' } | Select-Object -First 1) -split ' '
Click-Human ([int]([double]$q[1] + 32)) ([int]([double]$q[2] + 32)) 700
Wait-Cond { @(Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*wallpaper-app*' }).Count -eq 0 } 15000 '程式結束'
Log '✔ 已按 ✕ 結束程式（所有程序已關閉）'
Log ('全程 {0:N1} 秒' -f ((Get-Date) - $script:T0).TotalSeconds)
} catch {
  $failure = $_
  Log ("✖ 失敗：{0}" -f $_.Exception.Message)
  # 失敗當下留證據：整個螢幕的截圖＋當時網頁上的對話框狀態（在關閉桌面版之前）
  try { Log ('  失敗截圖：' + (Shot 'failure')) } catch { }
  try {
    $t = Wall-Target
    if ($t) { Log ('  網頁：' + $t.url.Substring(0, [Math]::Min(60, $t.url.Length)) + ' ｜ 對話框：' + (Cdp-Eval $t '(() => { const d = document.querySelector(".sheet[role=dialog], .modal"); return d ? d.innerText.replace(/\s+/g, " ").slice(0, 200) + " ｜ inputs=" + [...d.querySelectorAll("input,textarea")].map(i => (i.value || "").slice(0, 20)).join("/") : "（沒有開著的對話框）"; })()')) }
  } catch { }
}

# ── 安全網：失敗時桌面版可能還開著 ──────────────────────────────────────────
if ($failure -and $KeepAppOnFailure) {
  Log '（-KeepAppOnFailure：桌面版保持開啟、沒有清理。處理完請用右上角 ✕ 關掉，再跑 cleanup.py；介面記憶不會自動還原。）'
  throw $failure
}
if (App-Running) {
  Log '桌面版還開著（前面失敗了）→ 還原介面記憶、正常關閉'
  try {
    $t = Wall-Target
    $snapNow = $null
    if ($t.url -match ':8788/') { $snapNow = $snap88 }
    elseif ($t.url -match ':8787/' -and -not $restored87) { $snapNow = $snap87 }
    if ($snapNow) {
      Restore-Storage $t $snapNow
      if (Storage-Equal (Get-Storage $t) $snapNow) { Log '  ✔ 介面記憶已還原（已讀回確認）' } else { $warnings += '失敗後還原介面記憶：寫入後讀回不一致' }
      Start-Sleep -Milliseconds 1500      # 給瀏覽器一點時間把 localStorage 寫到磁碟，再關閉
    }
  } catch { $warnings += '失敗後還原介面記憶也失敗了：' + $_.Exception.Message }
  try { Quit-App; Wait-Cond { -not (App-Running) } 15000 '程式結束' } catch { $warnings += '無法正常關閉桌面版，請手動用右上角 ✕ 關掉再清理。' }
}

# ── 7. 清理這次新增的資料 ───────────────────────────────────────────────────
if ($NoCleanup) { Log '（-NoCleanup：保留這次新增的資料。下次啟動桌面版會重新出現兩個懸浮視窗。）' }
else {
  Log '清理這次新增的資料…'
  & python (Join-Path $PSScriptRoot 'cleanup.py') --title $NoteTitle --index $IndexName --import-dir $ImportDir --restore-wall $origWall --since $runStart 2>&1 | ForEach-Object { Log "  $_" }
  if ($LASTEXITCODE -ne 0) { $warnings += "清理腳本回報失敗（結束碼 $LASTEXITCODE），請看上面的訊息" }
}
if ($warnings.Count) { Log '⚠ 注意：'; $warnings | ForEach-Object { Log "  - $_" } } elseif (-not $failure) { Log '✔ 全部檢查通過' }
if ($failure) { throw $failure }
