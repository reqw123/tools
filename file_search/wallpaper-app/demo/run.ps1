#requires -Version 5.1
<#
  桌面牆「產品導覽」腳本——用真實滑鼠與鍵盤把主要功能完整走一遍，每一步在螢幕下方的字幕條說明正在展示什麼：

  四段可以只挑幾段看（-Sections），速度可調（-Speed，展示中按 F7 放慢／F9 加快），F8 暫停，
  按 F12 或動一下滑鼠就提前結束（一樣會清理）。雙擊「啟動-桌面牆自動化展示.bat」會先跳選單問這些。

    桌面牆外殼：右下角控制列（穿透／互動、隱藏／顯示）
    便利貼牆  ：新增（標籤、待辦清單）→ 牆上勾待辦（完成章）→ 釘選 → 搜尋 → 分類篩選 → 淺／深色主題
                → 拉框裁切 → 拖出去懸浮（已達上限時改展示上限提醒）→ 刪除 → 從垃圾桶復原 → 批次新增
                → 從 JSON 匯入範例資料 → AI 搜尋（模擬回答，不呼叫 API）→ 批次刪除一個分類 → 匯出 HTML
    設定視窗  ：Shift+V、牆面透明度即時預覽、試聽到期鬧鐘
    索引牆    ：Shift+C 切換 → 新增索引集 → 匯入資料夾（掃描：類別分佈／副檔名、依類型篩選）
                → 批次分類（上層資料夾／檔案類型）→ 批次補說明（擷取內容，不用 AI）→ 預覽檔案 → 手動改說明／分類
                → 文件檢視 → 分組
                → 搜尋＋預覽影片 → 拖成懸浮視窗 → 拉大 → 播放 N 秒後停止 → 按右上角 ✕ 結束程式

  AI 搜尋用「模擬回答」示範（攔下那一支 API、回預先寫好的答案，字幕註明），不實際呼叫 AI；AI 生成便利貼、
  批次補說明的「用 AI 產生」不展示。螢幕右側整場常駐「對原始檔案唯讀」的說明。
  執行時滑鼠與鍵盤會被接管約 4 分鐘（全部段落），請不要碰。結束後預設會把這次新增的資料清掉、把動到的設定還原
  （便利貼含垃圾桶、索引集、懸浮視窗紀錄、模式／透明度／裁切；只動這次產生、且精確比對得到的項目），
  要保留加 -NoCleanup。詳見 README.md（含「這是重播不是自主操作」的說明）。

  用法：  powershell -ExecutionPolicy Bypass -File wallpaper-app\demo\run.ps1
          powershell -ExecutionPolicy Bypass -File wallpaper-app\demo\run.ps1 -PlaySeconds 3 -NoCleanup
          powershell -ExecutionPolicy Bypass -File wallpaper-app\demo\run.ps1 -Sections sticky,index -Speed 0.7
#>
param(
  [string]$ImportDir = '',                                                  # 要匯入的資料夾；不給就用 -DocsDir 的展示文件＋media\ 的影片（複製到「文件」底下暫放）
  [string]$DocsDir = '',                                                    # 展示用文件（各種類型，給掃描／批次分類／批次補說明用）；預設 file_search\功能展示用文件
  [string]$VideoFile = 'cat-demo.mp4',                                      # 要預覽／播放的影片（要在 ImportDir 底下）
  [int]$PlaySeconds = 4,                                                    # 播放幾秒後停止
  [string]$IndexName = '貓咪自拍影片',                                      # 這次新建的索引集名稱（同時當匯入的分類）
  [string]$NoteTitle = 'AI 自動化展示',                                     # 展示用便利貼的標題
  [string[]]$Sections = @('shell', 'sticky', 'settings', 'index'),         # 要看哪幾段：shell 桌面牆外殼／sticky 便利貼牆／settings 設定視窗／index 索引牆
  [double]$Speed = 1.0,                                                     # 速度：2＝停頓減半、0.5＝停頓加倍（只影響讓觀眾閱讀的停頓，滑鼠移動維持人的節奏）
  [switch]$NoCleanup,                                                       # 跑完不要清掉新增的資料
  [switch]$KeepAppOnFailure                                                 # 失敗時讓桌面版留著開著、不清理（除錯用）
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\cdp.ps1"

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path            # file_search\
$IDX = Join-Path $Root 'indexes'
$OutDir = Join-Path $PSScriptRoot 'out'; New-Item -ItemType Directory -Force $OutDir | Out-Null
$log = Join-Path $OutDir 'run.log'
$script:T0 = Get-Date
# run.log 整場只開一次、允許別的程式同時讀寫（FileShare.ReadWrite）：每行重開檔（Add-Content）時，只要有人正在看
# 這個檔（例如 tail -f），就會「檔案正在使用中」直接讓整場展示失敗。寫 UTF-8（PowerShell 5.1 的 Tee-Object -Append 寫 UTF-16，
# 接在 UTF-8 檔後面會整份變亂碼）。寫檔失敗只少一行紀錄，不能讓展示中斷。
$script:LogW = New-Object IO.StreamWriter((New-Object IO.FileStream($log, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)), (New-Object Text.UTF8Encoding $true))
$script:LogW.AutoFlush = $true
function Log([string]$m) { $line = '[{0,6:N1}s] {1}' -f ((Get-Date) - $script:T0).TotalSeconds, $m; Write-Host $line; try { $script:LogW.WriteLine($line) } catch { } }
$validSections = 'shell', 'sticky', 'settings', 'index'
$Sections = @($Sections | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
$bad = @($Sections | Where-Object { $validSections -notcontains $_ })
if ($bad.Count) { throw "不認得的段落：$($bad -join ', ')（可用：$($validSections -join ', ')）" }
if (-not $Sections.Count) { $Sections = $validSections }
function Want([string]$name) { $Sections -contains $name }
if ($Speed -le 0) { throw '-Speed 要大於 0' }
$script:Pace = 1 / $Speed                                                 # 停頓的倍數；展示中按 F7／F9 會改它

# 使用者介入：游標被人動了（偏離腳本最後放的位置）或按 F12 ＝提前結束；F8 暫停／繼續；F7 放慢、F9 加快。
# lib.ps1 的 Move-Mouse／Type-Text、cdp.ps1 的等待迴圈都會呼叫 Check-User，所以任何時候都反應得到。
# 這幾個鍵展示本身都不會按（它只按 Shift／Ctrl／Enter／Esc／方向鍵／字母），不會誤觸。
function Key-Pressed([int]$vk) { [DemoKeys]::Take($vk) -gt 0 }        # 上次檢查之後有沒有按過（背景執行緒記的，不會漏）
$script:PausedMs = 0                                                      # 累計暫停了多久（等待逾時會扣掉，見 cdp.ps1 的 Wait-Elapsed）
$script:LastCaption = @('準備中', '開啟桌面牆…', '桌面牆啟動中，請稍候。')   # 還沒到第一步就跳系統提示時，處理完換回這句
function Pace-Hint { Caption-Hint ('F8 暫停　F7 慢／F9 快（{0:0.0#}×）　F12 或動滑鼠＝結束' -f (1 / $script:Pace)) }
function Check-User {
  if ($script:Aborting) { return }
  if ([DemoKeys]::SystemPrompt()) {
    # Windows 跳出系統提示（換電腦第一次執行最常見：防火牆詢問是否允許網路存取）——它要使用者自己決定，腳本不替人按。
    # 暫停、請使用者處理（這時可以自由動滑鼠），提示消失後自動繼續
    $pt0 = Get-Date; [DemoKeys]::Disarm(); Log '  （Windows 跳出系統提示，暫停等使用者處理）'
    Caption-Set '請先處理' 'Windows 跳出了系統提示' '例如第一次執行時的防火牆詢問：按「允許」或「取消」都可以——展示只用本機連線，不受影響。處理完會自動繼續。'
    Caption-Hint '⏸ 等你處理 Windows 的提示…（F12 結束展示）'
    while ([DemoKeys]::SystemPrompt()) {
      if (Key-Pressed 0x7B) { $script:Aborting = $true; throw 'USER_ABORT：按了 F12' }
      Start-Sleep -Milliseconds 200
    }
    Start-Sleep -Milliseconds 800                                         # 提示剛關掉，焦點還在移回來
    $script:PausedMs += ((Get-Date) - $pt0).TotalMilliseconds
    Caption-Set $script:LastCaption[0] $script:LastCaption[1] $script:LastCaption[2]; Pace-Hint
    [DemoKeys]::Arm(); Log '  （系統提示已處理，繼續）'
  }
  if ([DemoKeys]::TakeMoved()) { $script:Aborting = $true; throw 'USER_ABORT：偵測到滑鼠被移動' }
  if (Key-Pressed 0x7B) { $script:Aborting = $true; throw 'USER_ABORT：按了 F12' }
  if (Key-Pressed 0x76) { $script:Pace = [math]::Min(4, $script:Pace * 1.3); Pace-Hint; Log ('  （放慢：{0:0.0#}×）' -f (1 / $script:Pace)) }
  if (Key-Pressed 0x78) { $script:Pace = [math]::Max(0.25, $script:Pace / 1.3); Pace-Hint; Log ('  （加快：{0:0.0#}×）' -f (1 / $script:Pace)) }
  if (Key-Pressed 0x77) {
    $pt0 = Get-Date; Log '  （暫停）'; Caption-Hint '⏸ 已暫停——按 F8 繼續，F12 結束（暫停時可以自由動滑鼠）'
    [DemoKeys]::Disarm()                                                  # 暫停時動滑鼠是正常的，不算要結束
    while (-not (Key-Pressed 0x77)) {
      if (Key-Pressed 0x7B) { $script:Aborting = $true; throw 'USER_ABORT：按了 F12' }
      Start-Sleep -Milliseconds 50
    }
    $script:PausedMs += ((Get-Date) - $pt0).TotalMilliseconds
    [DemoKeys]::Arm()                                                     # 從現在的游標位置接著偵測
    Log '  （繼續）'; Pace-Hint
  }
}
function Hold([int]$ms) {                                                 # 讓觀眾看清楚的停頓（依速度縮放；切小段以便隨時反應暫停／中止）
  $end = (Get-Date).AddMilliseconds($ms * $script:Pace)
  do { Check-User; Start-Sleep -Milliseconds 40 } while ((Get-Date) -lt $end)
}
function Js([string]$s) { ($s | ConvertTo-Json -Compress) }               # 字串 → JS 字面值（含跳脫）
$wall = { Wall-Target }
$floatEntry = { Float-Target 8788 }
$floatNote = { Float-Target 8787 }
$ctrl = { Cdp-Targets | Where-Object { $_.url -match 'wall-controls\.html' } | Select-Object -First 1 }
$settingsWin = { Cdp-Targets | Where-Object { $_.url -match 'settings\.html' } | Select-Object -First 1 }
$warnings = @()

# ── 字幕：每一步顯示「段落 · 第幾步 / 共幾步」＋標題＋說明 ─────────────────────────
# 總步數直接數這支腳本裡有幾個 Step 呼叫（每個 Step 都只寫一次、不放在 if/else 兩邊），加減步驟不用手動改數字。
# 用「#@section 名稱」標記切段，只數有選到的段落（開場 intro、結束 end 一定算）。
$script:StepNo = 0
$script:StepTotal = 0
foreach ($chunk in ((Get-Content -LiteralPath $PSCommandPath -Raw -Encoding UTF8) -split '(?m)^\s*#@section\s+')) {
  $name = ($chunk -split '\s', 2)[0]
  if ($name -in @('intro', 'end') -or (Want $name)) { $script:StepTotal += ([regex]::Matches($chunk, '(?m)^\s*Step\s+''')).Count }
}
function Step([string]$section, [string]$title, [string]$desc, [int]$read = 1500) {
  $script:StepNo++
  $script:LastCaption = @(('{0} · {1} / {2}' -f $section, $script:StepNo, $script:StepTotal), $title, $desc)   # 系統提示暫停後要換回來
  Caption-Set $script:LastCaption[0] $title $desc
  Log ('▶ [{0}/{1}] {2}｜{3}' -f $script:StepNo, $script:StepTotal, $section, $title)
  Hold $read                                                              # 先讓觀眾讀完字幕再動手
}

# ── 小工具 ────────────────────────────────────────────────────────────────────
function Ctrl-State { Cdp-Eval (& $ctrl) '({mode: document.getElementById("modeBtn").classList.contains("alt") ? "background" : "interactive", visible: !document.getElementById("visBtn").classList.contains("alt")})' }
# 多行文字：每行之間按 Enter（直接送 "`n" 字元進 textarea 不會換行），打完讀回比對，掉字就全選刪掉重打
function Type-Lines([scriptblock]$getTarget, [string]$expr, [string[]]$lines) {
  [void](Click-Elem $getTarget $expr)
  $want = $lines -join "`n"; $v = $null
  for ($try = 1; $try -le 3; $try++) {
    if ($try -gt 1) { Press-Combo @(0x11, 0x41); Press-Combo @(0x08); Log "  （多行內容掉字，全部重打第 $try 次）" }
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($i) { Press-Combo @(0x0D) }; Type-Text $lines[$i] 22 }
    Hold 300
    $v = Cdp-Eval (& $getTarget) "(() => { $($script:JSHELP) const e = $expr; return e ? e.value : null; })()"
    if ($v -ceq $want) { return }
  }
  throw "多行欄位內容跟預期不符：預期「$want」，實際「$v」"
}
$noteJs = '[...document.querySelectorAll(".wall .note")].find(n => norm(n.querySelector("h3") || n) === ' + (Js $NoteTitle) + ')'

# ── 換機器也能跑：環境準備 ──────────────────────────────────────────────────
# 不依賴這台電腦的任何路徑：素材都在 repo 裡（media\、功能展示用文件\），範例資料當場產生，
# 暫放資料夾／暫存檔用 %USERPROFILE%、%PUBLIC% 算出來。git 不收的東西（node_modules、前端 dist）在這裡補齊——
# 跟「啟動-桌面便利貼牆.bat」做的一樣：缺相依套件就 npm install，前端原始碼比 dist 新就重新 build。
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw '找不到 Node.js（node／npm）。請先安裝 LTS 版：https://nodejs.org/'
}
$appDir = Join-Path $Root 'wallpaper-app'
foreach ($dep in @(
    @{ dir = $appDir; probe = 'node_modules\electron\dist\electron.exe' },
    @{ dir = (Join-Path $Root 'notes-web'); probe = 'node_modules' },
    @{ dir = (Join-Path $Root 'files-web'); probe = 'node_modules' })) {
  if (-not (Test-Path -LiteralPath (Join-Path $dep.dir $dep.probe))) {
    Write-Host "[準備] 第一次執行：在 $($dep.dir) 安裝相依套件（npm install，需要網路，可能要幾分鐘）…"
    Push-Location $dep.dir
    try { & npm.cmd install; if ($LASTEXITCODE -ne 0) { throw "npm install 失敗（$($dep.dir)），結束碼 $LASTEXITCODE" } } finally { Pop-Location }
  }
}
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $appDir 'rebuild-if-stale.ps1') -ProjectRoot $Root | ForEach-Object { Write-Host "[準備] $_" }
if ($LASTEXITCODE -ne 0) { throw '前端網頁 build 失敗，請看上面的訊息。' }
# 清理用 Python：有的電腦只有 py 啟動器、或 python 只是 Microsoft Store 的捷徑（執行會失敗）——實際跑一次確認
$pyCmd = $null
foreach ($cand in @(@('python'), @('py', '-3'), @('python3'))) {
  if (-not (Get-Command $cand[0] -ErrorAction SilentlyContinue)) { continue }
  try { $out = & $cand[0] @($cand | Select-Object -Skip 1) -c 'print(42)' 2>$null; if ($LASTEXITCODE -eq 0 -and "$out".Trim() -eq '42') { $pyCmd = $cand; break } } catch { }
}
if (-not $pyCmd -and -not $NoCleanup) { throw '找不到可以執行的 Python 3（清理展示資料要用）。請安裝 Python 3，或加 -NoCleanup 跳過清理。' }

# ── 事前檢查 ────────────────────────────────────────────────────────────────
if (@(Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*wallpaper-app*' }).Count -gt 0) { throw '桌面牆已經開著，請先結束它（右上角 ✕）再執行。' }
if (Test-Path -LiteralPath (Join-Path $IDX "$IndexName.md")) { throw "索引集 $IndexName.md 已存在，請換一個 -IndexName（腳本不會覆蓋既有的索引集）。" }
# 沒給 -ImportDir → 組一個展示素材資料夾：最上層放 -DocsDir 的各類文件、子資料夾「影片」放 media\ 的影片
# （兩層才看得出「依上層資料夾分類」的效果）。repo 不在 下載／文件／家目錄 底下，檔案瀏覽器點不進去，
# 所以複製到「文件」底下暫放，跑完（有清理時）再刪掉。
$mediaDir = Join-Path $PSScriptRoot 'media'
if (-not $DocsDir) { $DocsDir = Join-Path $Root '功能展示用文件' }
$stagingDir = $null
if (-not $ImportDir) {
  if (-not (Test-Path -LiteralPath $DocsDir -PathType Container)) { throw "找不到展示用文件資料夾：$DocsDir（或用 -DocsDir 指定）" }
  # 檔案瀏覽器的「文件」捷徑只在 %USERPROFILE%\Documents 真的存在時才出現（例如被 OneDrive 搬走就沒有）——那就放家目錄
  $stageParent = if (Test-Path -LiteralPath (Join-Path $env:USERPROFILE 'Documents') -PathType Container) { Join-Path $env:USERPROFILE 'Documents' } else { $env:USERPROFILE }
  $ImportDir = Join-Path $stageParent '桌面牆展示素材'
  $expected = @(Get-ChildItem -LiteralPath $DocsDir -File | ForEach-Object Name) + @(Get-ChildItem -LiteralPath $mediaDir -File | ForEach-Object { "影片\$($_.Name)" })
  if (Test-Path -LiteralPath $ImportDir) {
    # 只接受「裡面全是這些素材」的殘留（上次中斷或 -NoCleanup 留下的），別的東西一律不碰
    $foreign = @(Get-ChildItem -LiteralPath $ImportDir -Recurse -Force | Where-Object {
      $rel = $_.FullName.Substring($ImportDir.Length + 1)
      if ($_.PSIsContainer) { $rel -ne '影片' } else { $expected -notcontains $rel } })
    if ($foreign.Count) { throw "暫放資料夾 $ImportDir 已存在且有別的東西（$($foreign[0].Name) 等），請先移走或用 -ImportDir 指定別的資料夾。" }
  }
  New-Item -ItemType Directory -Force (Join-Path $ImportDir '影片') | Out-Null
  Copy-Item -Path (Join-Path $DocsDir '*') -Destination $ImportDir -Force
  Copy-Item -Path (Join-Path $mediaDir '*') -Destination (Join-Path $ImportDir '影片') -Force
  $stagingDir = $ImportDir
}
if (-not (Test-Path -LiteralPath $ImportDir -PathType Container)) { throw "找不到資料夾：$ImportDir" }
if (-not (Get-ChildItem -LiteralPath $ImportDir -Recurse -File -Filter $VideoFile)) { throw "找不到影片：$VideoFile（要在 $ImportDir 底下）" }
$settingsPath = Join-Path $env:APPDATA 'wallpaper-app\settings.json'
$origSettings = if (Test-Path $settingsPath) { Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
$origWall = if ($origSettings) { $origSettings.wall } else { 'sticky' }
# 展示會切模式（startMode 跟著存檔）、調透明度、拉框裁切——記下原值，清理時照原樣寫回
$snapPath = Join-Path $OutDir 'settings-snapshot.json'
$snapObj = [ordered]@{}
if ($origSettings) { foreach ($k in 'startMode', 'wallOpacity', 'crop') { if ($origSettings.PSObject.Properties.Name -contains $k) { $snapObj[$k] = $origSettings.$k } } }
[IO.File]::WriteAllText($snapPath, ($snapObj | ConvertTo-Json -Compress -Depth 5), (New-Object Text.UTF8Encoding $false))
$floatsBefore = if ($origSettings -and $origSettings.pinnedNotes) { @($origSettings.pinnedNotes.PSObject.Properties).Count } else { 0 }
# 「從 JSON 匯入」用的範例便利貼（各分類），id 一律 demo-import- 開頭——清理靠這個前綴精確認出來，不靠時間或標籤猜
$nowIso = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.fff')
$demoNotes = @(
  @{ tag = '工作'; title = '週會簡報';     body = "整理本週進度`n更新甘特圖`n寄出會議記錄" },
  @{ tag = '工作'; title = '客戶回信';     body = "回覆報價信`n確認交貨日期" },
  @{ tag = '學習'; title = '英文單字';     body = "每天背 20 個`n週末複習整週" },
  @{ tag = '學習'; title = '線上課程進度'; body = "看完第 3 章`n寫完練習題" },
  @{ tag = '購物'; title = '生活用品';     body = "衛生紙`n洗衣精`n牙膏" },
  @{ tag = '購物'; title = '超市清單';     body = "牛奶`n雞蛋`n吐司`n蘋果" },
  @{ tag = '旅行'; title = '花蓮三天兩夜'; body = "訂火車票`n預約民宿`n查步道開放狀況" },
  @{ tag = '旅行'; title = '出國準備';     body = "確認護照效期`n換外幣`n保旅平險`n買轉接頭" },
  @{ tag = '旅行'; title = '旅行打包';     body = "防曬乳`n薄外套`n行動電源" },
  @{ tag = '健康'; title = '運動計畫';     body = "週一三五慢跑 30 分鐘`n週末游泳" },
  @{ tag = '健康'; title = '看診提醒';     body = "回診：下週二上午`n帶健保卡" }
)
for ($i = 0; $i -lt $demoNotes.Count; $i++) {
  $demoNotes[$i] = [pscustomobject]([ordered]@{ id = ('demo-import-{0:D2}' -f ($i + 1)); title = $demoNotes[$i].title; body = $demoNotes[$i].body; tag = $demoNotes[$i].tag
    image = ''; due_at = ''; pinned = $false; repeat = ''; created_at = $nowIso; assignee = ''; reactions = @{} })
}
# 系統檔案對話框裡要打完整路徑，路徑必須是純英數（中文會被輸入法攔截）——放在 C:\Users\Public
$publicDir = if ($env:PUBLIC -and (Test-Path -LiteralPath $env:PUBLIC)) { $env:PUBLIC } else { Join-Path $env:SystemDrive 'Users\Public' }
$demoJson = Join-Path $publicDir 'desktop-wall-demo-notes.json'
$demoHtml = Join-Path $publicDir 'desktop-wall-demo-export.html'
foreach ($f in $demoJson, $demoHtml) { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force } }
[IO.File]::WriteAllText($demoJson, ([ordered]@{ notes = $demoNotes } | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
# AI 搜尋示範的「模擬回答」——照範例資料的「旅行」分類寫，最後一行註明沒有實際呼叫 AI
$travel = @($demoNotes | Where-Object { $_.tag -eq '旅行' })
$aiAnswer = "「旅行」分類共有 $($travel.Count) 則便利貼：`n" + (($travel | ForEach-Object -Begin { $n = 0 } -Process { $n++; "$n. $($_.title)——" + (($_.body -split "`n") -join '、') }) -join "`n") +
  "`n`n建議先處理「出國準備」裡的護照和外幣，需要的時間最長。`n`n（展示用的模擬回答：這一步沒有實際呼叫 AI）"
# 索引牆「預覽＋手動編輯」示範用的檔案：挑展示文件裡第一個純文字類（預覽看得到內容）
$editFile = Get-ChildItem -LiteralPath $DocsDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.txt', '.md', '.py', '.json', '.h' } |
  Sort-Object { @('.txt', '.md', '.py', '.json', '.h').IndexOf($_.Extension) } | Select-Object -First 1
$editStem = if ($editFile) { [IO.Path]::GetFileNameWithoutExtension($editFile.Name) } else { [IO.Path]::GetFileNameWithoutExtension($VideoFile) }
# 全域快捷鍵照這台電腦的設定（使用者可能改過 Shift+C／Shift+V）；讀不懂就用預設
function Accel-Keys([string]$accel, [string]$fallback) {
  foreach ($a in $accel, $fallback) {
    if (-not $a) { continue }
    $vks = @(); $ok = $true
    foreach ($part in ($a -split '\+')) {
      switch -Regex ($part.Trim()) {
        '^(Shift)$'                                  { $vks += 0x10; continue }
        '^(Ctrl|Control|CmdOrCtrl|CommandOrControl)$' { $vks += 0x11; continue }
        '^(Alt|Option)$'                             { $vks += 0x12; continue }
        '^[A-Za-z0-9]$'                              { $vks += [int][char]$part.Trim().ToUpper(); continue }
        '^F([1-9]|1[0-9]|2[0-4])$'                   { $vks += 0x6F + [int]$Matches[1]; continue }
        default                                      { $ok = $false }
      }
    }
    if ($ok -and $vks.Count -ge 2) { return @{ label = $a; vks = [byte[]]$vks } }
  }
}
$sc = if ($origSettings -and $origSettings.shortcuts) { $origSettings.shortcuts } else { $null }
$keySwitch = Accel-Keys $(if ($sc) { $sc.switchWall }) 'Shift+C'
$keySettings = Accel-Keys $(if ($sc) { $sc.openSettings }) 'Shift+V'
$runStart = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$snap87 = $null; $snap88 = $null; $restored87 = $false; $failure = $null; $userAbort = $false; $script:Aborting = $false
function App-Running { @(Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*wallpaper-app*' }).Count -gt 0 }
function Quit-App { $qt = Cdp-Targets | Where-Object { $_.url -match 'quit-button' } | Select-Object -First 1; if ($qt) { [void](Cdp-Eval $qt 'window.dwQuit.quit()') } }   # 不用滑鼠的關閉（安全網用）

Caption-Start
Notice-Start '你的原始檔案：唯讀' ("索引牆只讀取檔案、記下路徑與說明，資料存在系統自己的索引檔。`n`n移除項目、刪除索引集、批次操作都只動索引紀錄——硬碟上的原檔案不會被移動、修改或刪除。便利貼插圖也是另外複製一份。")
Pace-Hint
Log ('段落：{0}　速度：{1:0.0#}×' -f ($Sections -join ', '), $Speed)
try {
#@section intro
Caption-Set '準備中' '開啟桌面牆…' '桌面牆啟動中，請稍候。'
Log '開啟離線牆（桌面版）'
Start-Process -FilePath 'npm.cmd' -ArgumentList 'start', '--', '--remote-debugging-port=9333' -WorkingDirectory (Join-Path $Root 'wallpaper-app') -WindowStyle Hidden
Wait-Cond { (Wall-Target) -and (& $ctrl) } 60000 '牆視窗出現'
# 桌面牆會開在使用者上次停的那面牆——停在索引牆就先切回便利貼牆（設定裡的 wall 由清理還原）
if ((Wall-Target).url -match ':8788/') {
  Wait-Rect $wall 'document.querySelector("button[title^=\"新增索引集\"]")' 60000 | Out-Null
  Log '  （上次停在索引牆，先切到便利貼牆）'
  Press-Combo $keySwitch.vks
  Wait-Cond { (Wall-Target).url -match ':8787/' } 10000 '切到便利貼牆'
}
Wait-Cond { Find-Rect (Wall-Target) 'T(".coll-tab","生活")' } 60000 '牆載入完成'
$snap87 = Get-Storage (Wall-Target)         # 記下便利貼牆的介面記憶，結束前還原
[void](Key-Pressed 0x76); [void](Key-Pressed 0x77); [void](Key-Pressed 0x78)   # 啟動期間（還沒開始展示）按的鍵不算
[DemoKeys]::Arm()                                                         # 開始偵測「有人動滑鼠」
Step '桌面牆' '整個桌面變成一面便利貼牆' '便利貼和檔案索引直接貼在桌面上：全螢幕、透明、永遠在最上層，不用另外開視窗找。' 2600
[void](Shot 'r01-wall')

#@section shell ══ 一、桌面牆外殼 ══════════════════════════════════════════════
if (Want 'shell') {
$wasInteractive = (Ctrl-State).mode -eq 'interactive'
Step '桌面牆' '右下角控制列：穿透模式' '牆「看得到、點不到」——滑鼠直接穿過牆，照常操作桌面和其他視窗（快捷鍵 Shift+Z）。'
if ($wasInteractive) {
  [void](Click-Elem $ctrl 'document.getElementById("modeBtn")')
  Wait-Cond { (Ctrl-State).mode -eq 'background' } 5000 '切成穿透模式'
}
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
Move-Mouse ([int]($wa.Width * 0.35)) ([int]($wa.Height * 0.45)) 600; Move-Mouse ([int]($wa.Width * 0.6)) ([int]($wa.Height * 0.35)) 600
Hold 900

Step '桌面牆' '切回互動模式' '再按一次同一顆鈕：可以點便利貼、新增和編輯。目前模式一眼就看得出來（黃銅色＝互動）。'
[void](Click-Elem $ctrl 'document.getElementById("modeBtn")')
Wait-Cond { (Ctrl-State).mode -eq 'interactive' } 5000 '切回互動模式'
Hold 900

Step '桌面牆' '一鍵隱藏／顯示整面牆' '控制列上面那顆（或 Shift+X）：牆整個收起來，控制列留在原地，隨時一鍵叫回來。'
[void](Click-Elem $ctrl 'document.getElementById("visBtn")')
Wait-Cond { -not (Ctrl-State).visible } 5000 '牆隱藏'
Hold 1800; [void](Shot 'r02-hidden')
[void](Click-Elem $ctrl 'document.getElementById("visBtn")')
Wait-Cond { (Ctrl-State).visible } 5000 '牆顯示'
Hold 800

}
# 沒看「外殼」段、而牆是用穿透模式啟動的 → 不出聲地切成互動模式，後面才點得到牆上的東西
if ((Ctrl-State).mode -ne 'interactive') {
  [void](Click-Elem $ctrl 'document.getElementById("modeBtn")' -Fast)
  Wait-Cond { (Ctrl-State).mode -eq 'interactive' } 5000 '切成互動模式'
}

#@section sticky ══ 二、便利貼牆 ════════════════════════════════════════════════
if (Want 'sticky') {
Step '便利貼牆' '新增便利貼' '填標題和分類標籤；內容裡「標籤：值」是填空欄，其他每一行自動變成可以勾選的待辦。'
[void](Click-Elem $wall 'T(".coll-tab","生活")')
[void](Click-Elem $wall 'T("button","新增便利貼")')
Type-Into $wall 'I[0]' $NoteTitle 30
Type-Into $wall 'I[1]' '展示' 30 -SelectAll
# 填空欄用半形冒號：全形「：」會被中文輸入法吃進組字狀態、晚一拍才送出，順便吃掉後面的 Enter（實測整段順序錯亂）
Type-Lines $wall 'D.querySelector("textarea")' @('說明: 這張便利貼是 AI 用真實滑鼠與鍵盤自己新增的', '準備展示素材', '錄製操作畫面', '分享給大家')
Hold 500
[void](Click-Elem $wall 'X(".sheet[role=dialog] button","新增")')
Wait-Cond { (Get-Content (Join-Path $IDX '.sticky_notes.json') -Raw -Encoding UTF8) -match [regex]::Escape($NoteTitle) } 8000 '便利貼寫入檔案'
[void](Wait-Rect $wall $noteJs 8000)
Log '✔ 便利貼新增成功（已寫入檔案，畫面上可見）'
Hold 900; [void](Shot 'r03-note-added')

Step '便利貼牆' '直接在牆上勾待辦' '不用打開編輯：點框框就勾掉。還有沒做完的是紅色 ✗，全部勾完自動蓋上綠色完成章。'
$doneCount = { [int](Cdp-Eval (Wall-Target) "(() => { $($script:JSHELP) return $($noteJs)?.querySelectorAll('.task.done').length ?? 0; })()") }
for ($i = 0; $i -lt 3; $i++) {
  for ($try = 1; $try -le 3; $try++) {
    [void](Click-Elem $wall "$($noteJs)?.querySelectorAll('.task .box[role=checkbox]')[$i]")
    try { Wait-Cond { (& $doneCount) -ge ($i + 1) } 2500 "勾第 $($i + 1) 項"; break }
    catch {
      if ($_.Exception.Message -like 'USER_ABORT*' -or $try -eq 3) { throw }
      # 點歪了（打到卡片本身＝打開便利貼）——關掉重試，第二次起點擊點會避開被蓋住的地方
      if (Cdp-Eval (Wall-Target) '!!document.querySelector(".sheet[role=dialog]")') { Press-Combo @(0x1B); Hold 400 }
      Log "  （勾第 $($i + 1) 項沒反應，重試第 $($try + 1) 次）"
    }
  }
  Hold 350
}
Wait-Cond { Cdp-Eval (Wall-Target) "(() => { $($script:JSHELP) return !!$($noteJs)?.querySelector('.todo-stamp.all-done'); })()" } 5000 '完成章出現'
Log '✔ 三項待辦都勾完，出現完成章'
Hold 1200; [void](Shot 'r04-todo-done')

Step '便利貼牆' '釘選重要的便利貼' '按卡片角落的 ☆，這則就固定排在最前面那一列，不會被其他便利貼淹沒。'
[void](Click-Elem $wall "$($noteJs)?.querySelector('.pin-toggle')")
Wait-Cond { Cdp-Eval (Wall-Target) "(() => { $($script:JSHELP) return !!$($noteJs)?.closest('.pinned-row'); })()" } 5000 '移到釘選列'
Hold 1300

Step '便利貼牆' '即時搜尋' '打字的同時就篩選——標題、內容、分類都會比對。'
Type-Into $wall 'P("input","搜尋標題")' '展示' 60
Hold 1500
Press-Combo @(0x11, 0x41); Press-Combo @(0x08)
Hold 500

Step '便利貼牆' '依分類篩選' '每個分類自動配一個顏色；點分類就只看那一類，點「全部」回到整面牆。'
[void](Click-Elem $wall 'T(".chips .chip","展示")')
Hold 1500
[void](Click-Elem $wall 'T(".chips .chip","全部")')
Hold 600

Step '便利貼牆' '淺色／深色主題' '右上角切換：跟隨系統、固定淺色、固定深色，三段循環。'
$themeOrig = Cdp-Eval (Wall-Target) 'localStorage.getItem("sticky-wall-theme") || "system"'
$isDark = { Cdp-Eval (Wall-Target) '(document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark"' }
for ($k = 0; $k -lt 3 -and -not (& $isDark); $k++) { [void](Click-Elem $wall 'document.querySelector("button[title^=\"外觀：\"]")'); Hold 300 }
Hold 1500; [void](Shot 'r05-dark')
for ($k = 0; $k -lt 3 -and (Cdp-Eval (Wall-Target) 'localStorage.getItem("sticky-wall-theme") || "system"') -ne $themeOrig; $k++) { [void](Click-Elem $wall 'document.querySelector("button[title^=\"外觀：\"]")' -Fast); Hold 250 }
Hold 500

Step '便利貼牆' '拉框裁切' '在空白處拖一個框，牆就只留下框到的那幾則，其他桌面空間還給你；按「恢復完整畫面」復原。'
[void](Cdp-Eval (Wall-Target) 'window.scrollTo(0, 0)'); Hold 400
# 起點要在空白處（便利貼、工具列、標題區上按下不算拉框）——取牆面左邊的空白，從第一列便利貼的高度開始
$box = Cdp-Eval (Wall-Target) @'
(() => {
  const w = document.querySelector(".wall").getBoundingClientRect();
  const first = [...document.querySelectorAll(".wall .note")].map(n => n.getBoundingClientRect()).filter(r => r.top > 0).sort((a, b) => a.top - b.top)[0];
  const x0 = Math.max(8, w.left - 40), y0 = first.top + 20;
  const fx = (outerWidth - innerWidth) / 2, fy = outerHeight - innerHeight - fx;
  const k = devicePixelRatio || 1;   // 網頁座標 → 實體像素（顯示縮放不是 100% 的電腦）
  return { x1: (screenX + fx + x0) * k, y1: (screenY + fy + y0) * k, x2: (screenX + fx + w.left + first.width * 1.6) * k, y2: (screenY + fy + Math.min(innerHeight - 30, y0 + 300)) * k };
})()
'@
Move-Mouse ([int]$box.x1) ([int]$box.y1) 500; Hold 200
Drag-Mouse ([int]$box.x1) ([int]$box.y1) ([int]$box.x2) ([int]$box.y2) 900
Wait-Cond { Cdp-Eval (Wall-Target) '!!document.querySelector(".crop-restore")' } 5000 '進入裁切檢視'
Log '✔ 牆已裁切成只剩框到的便利貼'
Hold 2200; [void](Shot 'r06-cropped')
[void](Click-Elem $wall 'document.querySelector(".crop-restore")')
Wait-Cond { -not (Cdp-Eval (Wall-Target) '!!document.querySelector(".crop-restore")') } 5000 '恢復完整畫面'
Hold 900

$canFloat = $floatsBefore -lt 5
Step '便利貼牆' '拖出去變成懸浮便利貼' $(if ($canFloat) { '把便利貼拖到牆的邊緣，它就變成桌面上獨立的小視窗，可以隨意擺放；按 ↩ 收回牆上。' } else { "把便利貼拖到牆的邊緣就會變成獨立的小視窗——最多同時 5 則；目前已有 $floatsBefore 則，所以跳出上限提醒，並可直接在提醒裡收回。" })
$h3 = Wait-Rect $wall "$($noteJs)?.querySelector('h3')" 5000
Move-Mouse ([int]$h3.x) ([int]$h3.y) 500; Hold 200
Drag-Mouse ([int]$h3.x) ([int]$h3.y) 6 ([int]$h3.y) 650
if ($canFloat) {
  Wait-Cond { & $floatNote } 8000 '便利貼懸浮視窗出現'
  Log '✔ 便利貼已變成懸浮視窗'
  Hold 1800; [void](Shot 'r07-floating')
  [void](Click-Elem $floatNote 'document.querySelector(".focused-unpin")')
  Wait-Cond { -not (& $floatNote) } 5000 '懸浮便利貼收回'
} else {
  Wait-Rect $wall 'document.querySelector(".float-limit")' 5000 | Out-Null
  Log "✔ 已有 $floatsBefore 則懸浮，跳出上限提醒"
  Hold 2600; [void](Shot 'r07-float-limit')
  [void](Click-Elem $wall 'document.querySelector(".float-limit .fl-ok")')
}
Hold 700

Step '便利貼牆' '刪除會先進垃圾桶' '刪掉的便利貼不會馬上消失，先放進垃圾桶，誤刪也找得回來。'
[void](Click-Elem $wall "$($noteJs)?.querySelector('h3')")
[void](Click-Elem $wall 'X(".sheet[role=dialog] button","刪除")')
[void](Click-Elem $wall 'X(".sheet[role=dialog] button","確定刪除")')
Wait-Cond { -not (Cdp-Eval (Wall-Target) "(() => { $($script:JSHELP) return !!$noteJs; })()") } 5000 '便利貼從牆上消失'
Hold 900

Step '便利貼牆' '從垃圾桶復原' '打開垃圾桶，找到剛剛那則按「復原」，它就回到牆上。'
[void](Click-Elem $wall 'document.querySelector("button[title^=\"垃圾桶\"]")')
$restoreBtn = '[...[...document.querySelectorAll(".sheet[role=dialog] li")].find(li => norm(li).includes(' + (Js $NoteTitle) + '))?.querySelectorAll("button") ?? []].find(b => norm(b) === "復原")'
Hold 600
[void](Click-Elem $wall $restoreBtn)
Hold 500
Press-Combo @(0x1B)                                                       # Esc 關掉垃圾桶
[void](Wait-Rect $wall $noteJs 8000)
Log '✔ 便利貼已從垃圾桶復原'
Hold 1000

Step '便利貼牆' '批次新增' '一次建立多張同分類的空白便利貼（例如一週的待辦），之後再逐張填內容。'
[void](Click-Elem $wall 'document.querySelector("button[title=\"批次新增\"]")')
Type-Into $wall 'I[0]' '展示' 30 -SelectAll
Type-Into $wall 'I[1]' '3' 30 -SelectAll
Hold 400
[void](Click-Elem $wall 'T(".sheet[role=dialog] button","建立 3 張")')
Wait-Cond { [int](Cdp-Eval (Wall-Target) '[...document.querySelectorAll(".wall .note h3")].filter(h => /^展示 [123]$/.test(h.textContent.trim())).length') -ge 3 } 8000 '批次新增的 3 張出現'
Log '✔ 批次新增 3 張便利貼'
Hold 1500; [void](Shot 'r08b-batch-create')

Step '便利貼牆' '從 JSON 備份匯入' '換電腦或還原備份：選一份匯出的 JSON，便利貼會合併進來（已經有的自動略過）。這裡匯入一份各分類的範例資料。'
[void](Click-Elem $wall 'document.querySelector("button[title^=\"從先前備份的 JSON\"]")')
[void](Click-Elem $wall 'T(".sheet[role=dialog] button","選擇 JSON 檔案")')
$dlgTitle = FileDialog-Enter $demoJson
Log "  （系統對話框「$dlgTitle」輸入路徑）"
Wait-Cond { [int](Cdp-Eval (Wall-Target) ('[...document.querySelectorAll(".wall .note h3")].filter(h => ' + (ConvertTo-Json @($demoNotes | ForEach-Object title) -Compress) + '.includes(h.textContent.trim())).length')) -ge $demoNotes.Count } 10000 '範例便利貼出現在牆上'
Press-Combo @(0x1B)                                                       # 匯入完成的對話框若還開著就關掉
Log "✔ 從 JSON 匯入 $($demoNotes.Count) 則範例便利貼"
Hold 1800; [void](Shot 'r08c-json-import')

Step '便利貼牆' 'AI 搜尋：用一般語句問問題' '不用想關鍵字，直接問「旅行分類有哪些事要準備」，AI 整理重點並篩出相關便利貼。（示範用的模擬回答，這一步沒有實際呼叫 AI）'
# 只攔截 AI 搜尋這一支 API、回預先寫好的答案——其他請求照常走。示範完立刻還原。
$aiMock = [ordered]@{ answer = $aiAnswer; matchedIds = @($demoNotes | Where-Object { $_.tag -eq '旅行' } | ForEach-Object id); callCount = 0 } | ConvertTo-Json -Compress
[void](Cdp-Eval (Wall-Target) ("(() => { if (!window.__realFetch) window.__realFetch = window.fetch; const body = " + (Js $aiMock) + "; window.fetch = (input, init) => { const u = typeof input === 'string' ? input : input.url; if (u.includes('/api/ai/search')) return new Promise(r => setTimeout(() => r(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })), 1200)); return window.__realFetch(input, init); }; return 'mocked'; })()"))
try {
  [void](Click-Elem $wall 'document.querySelector("button[title^=\"AI 搜尋\"]")')
  Type-Into $wall 'P("input","問問題")' '旅行分類有哪些事要準備' 45
  Hold 400
  Press-Combo @(0x0D)
  Wait-Rect $wall 'document.querySelector(".sheet.answer")' 8000 | Out-Null
  Log '✔ AI 回答已顯示（模擬回答）'
  Hold 4200; [void](Shot 'r08d-ai-answer')
  Press-Combo @(0x1B)                                                     # 關掉回答，看牆上被篩出來的便利貼
  Hold 2000
  [void](Click-Elem $wall 'document.querySelector("button[title=\"切回一般搜尋\"]")')
} finally {
  try { [void](Cdp-Eval (Wall-Target) '(() => { if (window.__realFetch) { window.fetch = window.__realFetch; delete window.__realFetch; } return "restored"; })()') } catch { }
}
Hold 700

Step '便利貼牆' '批次刪除' '勾選要刪的便利貼（可以先搜尋縮小範圍），兩段確認後一次刪掉——一樣先進垃圾桶。這裡刪掉範例資料的「購物」分類。'
$shopTitles = @($demoNotes | Where-Object { $_.tag -eq '購物' } | ForEach-Object title)
[void](Click-Elem $wall 'document.querySelector("button[title=\"批次刪除\"]")')
Type-Into $wall 'document.querySelector(".bd-search")' '購物' 45
Hold 600
# 只勾範例資料的那幾則（標題完全相同）——不用「勾選目前顯示」，免得勾到使用者自己內容裡剛好有「購物」的便利貼
foreach ($t in $shopTitles) {
  [void](Click-Elem $wall ('[...document.querySelectorAll(".bd-list li")].find(li => norm(li.querySelector(".bd-title")) === ' + (Js $t) + ')?.querySelector("input[type=checkbox]")'))
}
$checkedNow = Cdp-Eval (Wall-Target) '[...document.querySelectorAll(".bd-list li input[type=checkbox]")].filter(c => c.checked).map(c => c.closest("li").querySelector(".bd-title").textContent.trim())'
if (@($checkedNow).Count -ne $shopTitles.Count -or @($checkedNow | Where-Object { $shopTitles -notcontains $_ }).Count) { throw "批次刪除勾到的不是預期的範例便利貼：$($checkedNow -join '、')" }
Hold 900
[void](Click-Elem $wall 'T(".sheet[role=dialog] button","刪除勾選的")')
[void](Click-Elem $wall 'T(".sheet[role=dialog] button","確定刪除")')
Wait-Cond { [int](Cdp-Eval (Wall-Target) ('[...document.querySelectorAll(".wall .note h3")].filter(h => ' + (ConvertTo-Json @($shopTitles) -Compress) + '.includes(h.textContent.trim())).length')) -eq 0 } 8000 '購物分類從牆上消失'
Log "✔ 批次刪除「購物」分類 $($shopTitles.Count) 則"
Hold 1200

Step '便利貼牆' '匯出成 HTML 網頁' '把目前顯示的便利貼存成一個網頁檔，不用裝任何程式就能打開、分享或列印。'
[void](Click-Elem $wall 'document.querySelector("button[title^=\"匯出成 HTML\"]")')
$dlgTitle = FileDialog-Enter $demoHtml
Log "  （系統對話框「$dlgTitle」輸入路徑）"
Wait-Cond { (Test-Path -LiteralPath $demoHtml) -and (Get-Item -LiteralPath $demoHtml).Length -gt 1000 } 10000 '匯出的 HTML 寫入'
Log ("✔ 匯出 HTML：{0:N0} KB" -f ((Get-Item -LiteralPath $demoHtml).Length / 1KB))
# 打開匯出的網頁給觀眾看：先把牆收起來，在桌面牆自己開一個視窗載入（不動使用者的瀏覽器），看完關掉、牆叫回來
[void](Click-Elem $ctrl 'document.getElementById("visBtn")' -Fast)
Wait-Cond { -not (Ctrl-State).visible } 5000 '牆隱藏'
$html = [IO.File]::ReadAllText($demoHtml, [Text.Encoding]::UTF8)
[void](Cdp-Eval (Wall-Target) ("(() => { const w = window.open('', 'demoexport', 'width=1180,height=820,left=170,top=50'); w.document.open(); w.document.write(" + (Js $html) + "); w.document.close(); window.__demoExport = w; return 'opened'; })()"))
Hold 2800; [void](Shot 'r08e-html-export')
[void](Cdp-Eval (Wall-Target) '(() => { window.__demoExport?.scrollBy({ top: 700, behavior: "smooth" }); return 1; })()')
Hold 2200
[void](Cdp-Eval (Wall-Target) '(() => { window.__demoExport?.close(); delete window.__demoExport; return 1; })()')
[void](Click-Elem $ctrl 'document.getElementById("visBtn")' -Fast)
Wait-Cond { (Ctrl-State).visible } 5000 '牆顯示'
Hold 800

}

#@section settings ══ 三、設定視窗 ══════════════════════════════════════════════
if (Want 'settings') {
Step '設定' "$($keySettings.label) 打開設定視窗" '切換哪面牆、模式、透明度、快捷鍵、顯示在哪個螢幕、開機自動啟動，全部在這裡。'
Press-Combo $keySettings.vks
Wait-Rect $settingsWin 'document.getElementById("opacity")' 10000 | Out-Null
Hold 1000

Step '設定' '牆面透明度：即時預覽' '拖動滑桿，牆的底色從全透明（只剩便利貼）到完整蓋住桌布，馬上看到效果。'
$op0 = [double](Cdp-Eval (& $settingsWin) 'document.getElementById("opacity").value')
$sl = Wait-Rect $settingsWin 'document.getElementById("opacity")' 5000
Click-Human ([int]($sl.l + 10 + ($sl.w - 20) * 0.75)) ([int]$sl.y)
Hold 1800; [void](Shot 'r08-opacity')
# 用方向鍵退回原值（每格 0.05）；不是 0.05 倍數的原值由清理腳本的設定快照補回
$op1 = [double](Cdp-Eval (& $settingsWin) 'document.getElementById("opacity").value')
$n = [int][math]::Round(($op1 - $op0) / 0.05)
for ($k = 0; $k -lt [math]::Abs($n); $k++) { Press-Combo @($(if ($n -gt 0) { 0x25 } else { 0x27 })); Start-Sleep -Milliseconds 60 }
Log ("透明度 {0} → {1} → {2}" -f $op0, $op1, (Cdp-Eval (& $settingsWin) 'document.getElementById("opacity").value'))
Hold 600

Step '設定' '到期提醒：試聽鬧鐘' '便利貼設了到期日，時間到會跳 Windows 通知並響鈴；這裡先試聽一次。'
[void](Click-Elem $settingsWin 'document.getElementById("testAlarm")')
Hold 2600
Press-Combo $keySettings.vks                                              # 再按一次同一組鍵關掉設定視窗
Wait-Cond { -not (& $settingsWin) } 5000 '設定視窗關閉'
Hold 500

}

#@section index ══ 四、索引牆 ════════════════════════════════════════════════════
if (Want 'index') {
Step '索引牆' "$($keySwitch.label) 切換到檔案索引牆" '同一個桌面的第二面牆：把散落各處的檔案整理成可搜尋、可預覽的清單。'
Restore-Storage (Wall-Target) $snap87; $restored87 = $true             # 靜默還原便利貼牆的介面記憶（非畫面操作）
Press-Combo $keySwitch.vks
Wait-Cond { (Wall-Target).url -match ':8788/' } 10000 '切到索引牆'
Wait-Rect $wall 'document.querySelector("button[title^=\"新增索引集\"]")' 10000 | Out-Null
$snap88 = Get-Storage (Wall-Target)         # 記下索引牆的介面記憶（此時還沒動過任何東西），結束前還原
Hold 900

Step '索引牆' '新增索引集' '一份索引集就是一份檔案清單（存成 .md 文件），可以建很多份、隨時切換。'
[void](Click-Elem $wall 'document.querySelector("button[title^=\"新增索引集\"]")')
Type-Into $wall '[...document.querySelectorAll(".modal input")].filter(vis)[0]' $IndexName 30
Hold 250
[void](Click-Elem $wall 'X(".modal button","建立")')
Wait-Cond { Test-Path -LiteralPath (Join-Path $IDX "$IndexName.md") } 8000 '索引集檔案建立'
Log "✔ 索引集「$IndexName」已建立"
Hold 500

Step '索引牆' '匯入整個資料夾' '用內建的檔案瀏覽器一層層點進資料夾，勾「包含子資料夾」，準備掃描。'
[void](Click-Elem $wall 'T("button","匯入資料夾")')
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
Hold 500
[void](Click-Elem $wall 'X(".modal button","下一步")')
[void](Click-Elem $wall 'T("label","包含子資料夾")')
Hold 400

$scanText = { Cdp-Eval (Wall-Target) '(() => { const e = document.querySelector(".bi-result"); return e ? e.textContent.replace(/\s+/g," ").trim() : ""; })()' }
Step '索引牆' '掃描：先看看資料夾裡有什麼' '按「掃描」：列出共有幾個檔案、各類別（文件／圖片／影音／程式碼…）和各副檔名各有幾個，已在清單裡的會自動略過。'
[void](Click-Elem $wall 'X(".bi-scan button","掃描")')
Wait-Rect $wall 'document.querySelector(".bi-result")' 30000 | Out-Null
$scanAll = & $scanText
Log "✔ 掃描結果：$scanAll"
if ($scanAll -notmatch '掃到\s*(\d+)') { throw "讀不到掃描筆數：$scanAll" }
$expected = [int]$Matches[1]
Wait-Rect $wall 'document.querySelector(".cat-pills")' 5000 | Out-Null
Hold 2600; [void](Shot 'r09-scan')

Step '索引牆' '只收錄特定類型' '點類型按鈕就只掃那一類（例如只要文件）；都不選＝全部收錄。這裡示範完再取消，全部匯入。'
# 挑一個有檔案、但不是全部檔案的類別來示範篩選：優先「文件」，沒有就取數量最多的那類
$demoType = Cdp-Eval (Wall-Target) @'
(() => {
  const pills = [...document.querySelectorAll(".cat-pills .cat-pill")]
    .map(p => ({ label: [...p.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join("").trim(), n: +(p.querySelector("b")?.textContent || 0) }))
    .filter(p => p.n > 0);
  const pick = pills.find(p => p.label === "文件") || pills.sort((a, b) => b.n - a.n)[0];
  return pick ? pick.label : "";
})()
'@
$typeBtn = '[...document.querySelectorAll(".type-btn")].find(b => b.textContent.trim().endsWith(' + (Js $demoType) + '))'
if ($demoType) {
  [void](Click-Elem $wall $typeBtn)
  [void](Click-Elem $wall 'X(".bi-scan button","掃描")')
  Wait-Cond { $t = & $scanText; $t -and $t -ne $scanAll } 15000 '依類型重新掃描'
  Log ("✔ 只掃「{0}」：{1}" -f $demoType, (& $scanText))
  Hold 2200; [void](Shot 'r10-scan-type')
  [void](Click-Elem $wall $typeBtn)
  [void](Click-Elem $wall 'X(".bi-scan button","掃描")')
  Wait-Cond { (& $scanText) -eq $scanAll } 15000 '取消篩選、重新掃描全部'
} else { Log '  （讀不到類別，略過類型篩選示範）' }
Hold 600

Step '索引牆' '一次匯入' '分類先留空——下一步用「批次分類」自動分好；說明也留空，之後用「批次補說明」補上。'
[void](Click-Elem $wall 'T(".modal-foot .btn.primary","匯入")')
$pat = [regex]::Escape($ImportDir)
Wait-Cond { @(Select-String -LiteralPath (Join-Path $IDX "$IndexName.md") -Pattern $pat).Count -ge $expected } 20000 "匯入 $expected 筆寫入"
Log "✔ 已匯入 $expected 筆（索引檔已寫入）"
Hold 1200; [void](Shot 'r11-imported')

Step '索引牆' '批次分類：依上層資料夾或檔案類型' '分類是空的項目，每筆先帶一個建議分類——來源可以選「上層資料夾」或「檔案類型」，看過再一次套用。'
[void](Click-Elem $wall 'T("button","批次分類")')
Wait-Rect $wall 'T(".modal button","上層資料夾")' 5000 | Out-Null
Hold 600
[void](Click-Elem $wall 'T(".modal button","上層資料夾")')
Hold 2000; [void](Shot 'r12-cat-folder')
[void](Click-Elem $wall 'T(".modal button","檔案類型")')
Hold 2000; [void](Shot 'r13-cat-type')
[void](Click-Elem $wall 'T(".modal button","套用勾選的")')
[void](Click-Elem $wall 'T(".modal button","確定補上")')
Wait-Cond { -not (Cdp-Eval (Wall-Target) '[...document.querySelectorAll(".modal")].some(m => m.textContent.includes("補上空白的"))') } 10000 '批次分類套用完成'
Log '✔ 批次分類完成（依檔案類型）'
Hold 1200

Step '索引牆' '批次補說明（擷取內容，不用 AI）' '說明是空的項目：程式碼、純文字、JSON 這類檔案自動擷取開頭內容當建議說明，看過再一次套用。'
[void](Click-Elem $wall 'T("button","批次補說明")')
Wait-Rect $wall 'T(".modal button","全部套用")' 8000 | Out-Null
# 清單前面常是擷取不到內容的檔案（音樂、圖片、Office）——捲到第一筆有建議文字的，讓觀眾看到擷取效果（找不到就算了）
try { Wait-Rect $wall '[...document.querySelectorAll(".modal textarea")].find(t => t.value.trim())' 3000 | Out-Null } catch { if ($_.Exception.Message -like 'USER_ABORT*') { throw } }
Hold 1800; [void](Shot 'r14-describe')
[void](Click-Elem $wall 'T(".modal button","全部套用")')
[void](Click-Elem $wall 'X(".modal button","套用勾選項目")')
[void](Click-Elem $wall 'T(".modal button","確定套用")')
Wait-Cond { -not (Cdp-Eval (Wall-Target) '[...document.querySelectorAll(".modal")].some(m => m.textContent.includes("全部套用"))') } 10000 '批次補說明套用完成'
Log '✔ 批次補說明完成'
Hold 1000

Step '索引牆' '直接預覽檔案內容' '展開任何一列就能預覽——文字、程式碼、圖片、影音、PDF 都行，不用另外開程式。'
Type-Into $wall 'P("input","搜尋檔名")' $editStem 40
[void](Click-Elem $wall 'document.querySelector(".row .row-head")')
[void](Click-Elem $wall 'T(".row button","預覽內容")')
Wait-Rect $wall 'document.querySelector(".row .preview")' 8000 | Out-Null
Log "✔ 預覽「$editStem」"
Hold 2600; [void](Shot 'r14b-preview')

Step '索引牆' '自己寫說明、改分類' '按「編輯」直接改這一列的分類和說明，存進索引檔——原檔案本身完全不動。'
[void](Click-Elem $wall 'T(".row button","編輯")')
Type-Into $wall 'P("input","留空")' '專題筆記' 45 -SelectAll
Type-Into $wall 'P("textarea","這一列在索引裡的說明")' '專題用的重點筆記' 45 -SelectAll
Hold 600
[void](Click-Elem $wall 'X(".row button","儲存變更")')
Wait-Cond { (Get-Content -LiteralPath (Join-Path $IDX "$IndexName.md") -Raw -Encoding UTF8) -match '專題用的重點筆記' } 8000 '說明寫入索引檔'
Log '✔ 手動修改分類與說明完成（已寫入索引檔）'
Hold 1600; [void](Shot 'r14c-edited')
[void](Click-Elem $wall 'P("input","搜尋檔名")' -Fast)
Press-Combo @(0x11, 0x41); Press-Combo @(0x08)                            # 清掉搜尋，回到完整清單
Hold 600


Step '索引牆' '文件檢視' '同一份索引集也能排版成一份文件（前言＋表格）閱讀；按「清單」切回來。'
[void](Click-Elem $wall 'X(".seg[aria-label=\"檢視方式\"] button","文件")')
Hold 2200; [void](Shot 'r15-doc')
[void](Click-Elem $wall 'X(".seg[aria-label=\"檢視方式\"] button","清單")')
Hold 600

Step '索引牆' '分組檢視' '剛剛分好的類別直接拿來分組：每組可以折疊、顯示筆數；也能依所在資料夾分組。'
$groupOrig = Cdp-Eval (Wall-Target) '(() => { const b = document.querySelector(".seg[aria-label=\"分組\"] button.on"); return b ? b.textContent.trim() : "不分組"; })()'
$groupDemo = if ($groupOrig -eq '分類') { '資料夾' } else { '分類' }
[void](Click-Elem $wall ('X(".seg[aria-label=\"分組\"] button",' + (Js $groupDemo) + ')'))
Hold 2200; [void](Shot 'r16-grouped')
[void](Click-Elem $wall ('X(".seg[aria-label=\"分組\"] button",' + (Js $groupOrig) + ')'))
Hold 600

Step '索引牆' '搜尋檔名＋直接預覽' '輸入關鍵字即時篩選；展開一列就能直接預覽圖片、影片、文字檔，不用另外開程式。'
$stem = [IO.Path]::GetFileNameWithoutExtension($VideoFile)
Type-Into $wall 'P("input","搜尋檔名")' $stem 30
[void](Click-Elem $wall 'document.querySelector(".row .row-head")')
[void](Click-Elem $wall 'T(".row button","預覽內容")')
Wait-Rect $wall 'document.querySelector(".row video")' 10000 | Out-Null
Log '✔ 影片預覽已顯示'
Hold 1500

Step '索引牆' '變成懸浮視窗' '任何一筆都能變成桌面上的小視窗——影片可以一邊工作一邊看。'
[void](Click-Elem $wall 'document.querySelector(".row button[title=\"按一下變懸浮視窗\"]")')
Wait-Cond { Float-Target 8788 } 8000 '影片懸浮視窗出現'
Log '✔ 影片項目已變成懸浮視窗'
Hold 500
[void](Click-Elem $floatEntry 'document.querySelector(".row-head")' -Fast)
[void](Click-Elem $floatEntry 'T("button","預覽內容")' -Fast)
Wait-Rect $floatEntry 'document.querySelector("video")' 10000 | Out-Null
Hold 800

Step '索引牆' '拉大視窗、播放影片' '懸浮視窗的邊緣和角落都能拖曳調整大小；點影片畫面就播放／暫停。'
# 手動拖拉邊界擴大：抓視窗右上角，一次同時拉寬＋拉高（真人也是這樣拉的）；游標在最外緣角落會變成斜向縮放
$g = Cdp-Eval (Float-Target 8788) '(() => { const k = devicePixelRatio || 1; return {x: screenX * k, y: screenY * k, w: outerWidth * k, h: outerHeight * k}; })()'
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
$g2 = Cdp-Eval (Float-Target 8788) '(() => { const k = devicePixelRatio || 1; return {x: screenX * k, y: screenY * k, w: outerWidth * k, h: outerHeight * k}; })()'
if ($g2.w -le $g.w -and $g2.h -le $g.h) {                          # 角落沒抓到 → 改抓右緣＋上緣（各拖一次）
  Log '  角落沒拖動，改抓右緣＋上緣'
  $ex = [int]($g.x + $g.w - 1); $ey = [int]($g.y + $g.h * 0.5)
  Move-Mouse $ex $ey 300; Hold 80
  Drag-Mouse $ex $ey ($ex + 340) $ey
  $tx = [int]($g.x + $g.w * 0.4); $ty = [int]($g.y + 1)
  Move-Mouse $tx $ty 250; Hold 80
  Drag-Mouse $tx $ty $tx ([int][math]::Max(40, $g.y - 220))
  $g2 = Cdp-Eval (Float-Target 8788) '(() => { const k = devicePixelRatio || 1; return {x: screenX * k, y: screenY * k, w: outerWidth * k, h: outerHeight * k}; })()'
}
Log ("✔ 拖拉後大小 {0}×{1}（原本 {2}×{3}）" -f $g2.w, $g2.h, $g.w, $g.h)
if ($g2.w -le $g.w -and $g2.h -le $g.h) { $warnings += '視窗沒有被拖大' }
Hold 300
# 播放 → N 秒 → 暫停（點影片畫面本身＝播放／暫停切換）
$vr = Wait-Rect $floatEntry 'document.querySelector("video")' 5000
Click-Human ([int]$vr.x) ([int]$vr.y) 450
$tPlay = Get-Date; Log "▶ 按下播放（預計 $PlaySeconds 秒後停止）"
Hold ([int]($PlaySeconds * 1000 / 2)); [void](Shot 'r17-playing')
$left = $PlaySeconds * 1000 - [int]((Get-Date) - $tPlay).TotalMilliseconds; if ($left -gt 0) { Hold $left }
Click-Human ([int]$vr.x) ([int]$vr.y) 60
$v = Cdp-Eval (Float-Target 8788) '(() => { const v = document.querySelector("video"); return {t: v.currentTime, paused: v.paused, ready: v.readyState, w: v.videoWidth, err: v.error ? v.error.code : 0}; })()'
Log ("⏸ 已暫停：paused={0}，影片時間 {1:N2} 秒，readyState={2}，畫面寬 {3}，錯誤碼 {4}" -f $v.paused, $v.t, $v.ready, $v.w, $v.err)
if (-not $v.paused) { $warnings += '影片沒有停下來' }
if ($v.t -lt ($PlaySeconds - 1) -or $v.t -gt ($PlaySeconds + 2)) { $warnings += ("影片實際播放了 {0:N2} 秒，跟預期 {1} 秒差很多（可能是解碼器不支援這支影片的編碼，或緩衝太慢）" -f $v.t, $PlaySeconds) }
Hold 900

}

#@section end ══ 結束 ════════════════════════════════════════════════════════════
Step '結束' '按右上角 ✕ 結束程式' '展示時新增的便利貼、索引集，以及調過的模式／透明度，接下來都會自動清除、還原。'
# 還原目前這面牆的介面記憶（沒看索引牆段時還停在便利貼牆）
$tNow = Wall-Target
$snapEnd = if ($tNow.url -match ':8788/') { $snap88 } elseif (-not $restored87) { $snap87 } else { $null }
if ($snapEnd) {
  Restore-Storage $tNow $snapEnd; if ($tNow.url -match ':8787/') { $restored87 = $true }
  if (-not (Storage-Equal (Get-Storage $tNow) $snapEnd)) { $warnings += '介面記憶沒有完全還原' } else { Log '✔ 介面記憶已還原' }
}
$q = (App-Windows | Where-Object { $_ -match ' 64 64 ' } | Select-Object -First 1) -split ' '
Click-Human ([int]([double]$q[1] + 32)) ([int]([double]$q[2] + 32)) 700
Wait-Cond { @(Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*wallpaper-app*' }).Count -eq 0 } 15000 '程式結束'
Log '✔ 已按 ✕ 結束程式（所有程序已關閉）'
Log ('全程 {0:N1} 秒' -f ((Get-Date) - $script:T0).TotalSeconds)
} catch {
  $failure = $_
  # 中止時滑鼠可能正按著（拖曳中）、Shift／Ctrl 可能正壓著——先全部放開，不然使用者接手時會卡住
  [DemoWin]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  foreach ($vk in 0x10, 0x11) { [DemoWin]::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero) }
  $script:Aborting = $true; [DemoKeys]::Disarm()                         # 後面的收尾不要再被滑鼠／按鍵打斷
  if ($_.Exception.Message -like 'USER_ABORT*') {
    $userAbort = $true
    Log ('■ 使用者提前結束（{0}）' -f ($_.Exception.Message -replace '^USER_ABORT：', ''))
    Caption-Set '提前結束' '展示已停止' '正在關閉桌面牆、清理展示資料並還原設定，請稍候…'
  } else {
  Log ("✖ 失敗：{0}" -f $_.Exception.Message)
  Caption-Set '展示中止' '這一步沒有成功' $_.Exception.Message
  # 失敗當下留證據：整個螢幕的截圖＋當時網頁上的對話框狀態（在關閉桌面版之前）
  try { Log ('  失敗截圖：' + (Shot 'failure')) } catch { }
  try {
    $t = Wall-Target
    if ($t) { Log ('  網頁：' + $t.url.Substring(0, [Math]::Min(60, $t.url.Length)) + ' ｜ 對話框：' + (Cdp-Eval $t '(() => { const d = document.querySelector(".sheet[role=dialog], .modal"); return d ? d.innerText.replace(/\s+/g, " ").slice(0, 200) + " ｜ inputs=" + [...d.querySelectorAll("input,textarea")].map(i => (i.value || "").slice(0, 20)).join("/") : "（沒有開著的對話框）"; })()')) }
  } catch { }
  }
}

# ── 安全網：失敗時桌面版可能還開著 ──────────────────────────────────────────
$script:Aborting = $true; [DemoKeys]::Disarm()                           # 展示段落結束，之後的收尾不再理會滑鼠／按鍵
if ($failure -and $KeepAppOnFailure -and -not $userAbort) {
  Caption-Stop; Notice-Stop
  Log '（-KeepAppOnFailure：桌面版保持開啟、沒有清理。處理完請用右上角 ✕ 關掉，再跑 cleanup.py；介面記憶不會自動還原。）'
  $script:LogW.Dispose()
  throw $failure
}
if (App-Running) {
  Log ('桌面版還開著（{0}）→ 還原介面記憶、正常關閉' -f $(if ($userAbort) { '提前結束' } else { '前面失敗了' }))
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

# ── 清理這次新增的資料、還原動到的設定 ───────────────────────────────────────
if ($NoCleanup) { Log '（-NoCleanup：保留這次新增的資料與設定變動。）' }
else {
  if (-not $failure -or $userAbort) { Caption-Set '結束' '清理展示資料…' '刪除展示便利貼與索引集，還原模式、透明度、裁切與懸浮視窗紀錄。' }
  Log '清理這次新增的資料…'
  & $pyCmd[0] @($pyCmd | Select-Object -Skip 1) (Join-Path $PSScriptRoot 'cleanup.py') --title $NoteTitle --index $IndexName --import-dir $ImportDir --restore-wall $origWall --settings-snapshot $snapPath --id-prefix 'demo-import-' --since $runStart 2>&1 | ForEach-Object { Log "  $_" }
  if ($LASTEXITCODE -ne 0) { $warnings += "清理腳本回報失敗（結束碼 $LASTEXITCODE），請看上面的訊息" }
  elseif ($stagingDir) {
    try { Remove-Item -LiteralPath $stagingDir -Recurse -Force; Log "  已刪除暫放資料夾 $stagingDir" }
    catch { $warnings += "暫放資料夾刪不掉：$stagingDir（$($_.Exception.Message)）" }
  }
  foreach ($f in $demoJson, $demoHtml) {
    if (Test-Path -LiteralPath $f) { try { Remove-Item -LiteralPath $f -Force; Log "  已刪除 $f" } catch { $warnings += "刪不掉 $f" } }
  }
}
if ($warnings.Count) { Log '⚠ 注意：'; $warnings | ForEach-Object { Log "  - $_" } } elseif (-not $failure) { Log '✔ 全部檢查通過' }
if ($userAbort) { Caption-Set '提前結束' '已清理完畢' '展示資料都清掉、設定也還原了。'; Start-Sleep -Milliseconds 1500 }
elseif (-not $failure) { Caption-Set '展示結束' '謝謝觀看' '以上是桌面牆的主要功能。'; Hold 2500 }
Caption-Stop; Notice-Stop
$script:LogW.Dispose()
if ($userAbort) { exit 2 }                                                # 使用者提前結束：不是錯誤，但讓啟動器知道沒有跑完
if ($failure) { throw $failure }
