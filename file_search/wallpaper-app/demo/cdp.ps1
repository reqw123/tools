# 透過 Electron 的除錯埠（--remote-debugging-port）查詢「網頁上某個按鈕現在在螢幕的哪裡」。
# 只用來「讀位置」，所有點擊／輸入／拖拉仍是真實滑鼠鍵盤。注意這不是「看畫面」——是走網頁的側門讀 DOM，見 README。
. "$PSScriptRoot\lib.ps1"
if (-not ([System.Management.Automation.PSTypeName]'DemoCur').Type) {
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class DemoCur {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize, flags; public IntPtr hCursor; public POINT pt; }
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO ci);
  [DllImport("user32.dll")] public static extern IntPtr LoadCursor(IntPtr h, int id);
  public static string Name() {
    var ci = new CURSORINFO(); ci.cbSize = Marshal.SizeOf(ci); GetCursorInfo(ref ci);
    int[] ids = {32512,32513,32646,32645,32644,32642,32643,32649};
    string[] n = {"ARROW","IBEAM","SIZEALL","SIZENS","SIZEWE","SIZENWSE","SIZENESW","HAND"};
    for (int i = 0; i < ids.Length; i++) if (LoadCursor(IntPtr.Zero, ids[i]) == ci.hCursor) return n[i];
    return "other";
  }
}
"@
}

$script:CdpPort = 9333

function Cdp-Targets {
  # PowerShell 5.1 的 Invoke-RestMethod 會把 JSON 陣列當成「一個物件」回傳，要用 foreach 展開才是一個個目標
  try { $j = Invoke-RestMethod "http://127.0.0.1:$($script:CdpPort)/json" -TimeoutSec 3; foreach ($x in $j) { if ($x.type -eq 'page') { $x } } } catch { }
}
function Wall-Target { Cdp-Targets | Where-Object { $_.url -match '^http://127\.0\.0\.1:(8787|8788)/' -and $_.url -notmatch 'focus=' } | Select-Object -First 1 }
function Float-Target([string]$port) { Cdp-Targets | Where-Object { $_.url -match "^http://127\.0\.0\.1:$port/" -and $_.url -match 'focus=' } | Select-Object -First 1 }

# 每個分頁重用同一條 WebSocket（原本每次查詢都重新連線，一個步驟要查好幾次，累積起來很慢）
$script:CdpWs = @{}
$script:CdpId = 0
function Cdp-Conn($target) {
  $u = $target.webSocketDebuggerUrl
  $c = $script:CdpWs[$u]
  if ($c -and $c.State -eq 'Open') { return $c }
  $c = New-Object Net.WebSockets.ClientWebSocket
  $c.ConnectAsync([uri]$u, [Threading.CancellationToken]::None).Wait()
  $script:CdpWs[$u] = $c
  return $c
}
function Cdp-Eval($target, [string]$expr) {
  $ct = [Threading.CancellationToken]::None
  $o = $null
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    try {
      $c = Cdp-Conn $target
      $script:CdpId++; $id = $script:CdpId
      $msg = @{ id = $id; method = 'Runtime.evaluate'; params = @{ expression = $expr; returnByValue = $true; awaitPromise = $true } } | ConvertTo-Json -Depth 6 -Compress
      $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
      $c.SendAsync((New-Object 'System.ArraySegment[byte]' -ArgumentList (, $bytes)), 'Text', $true, $ct).Wait()
      $buf = New-Object byte[] 65536
      do {   # 收到「id 對得上」的那則回應為止（前面逾時的查詢若遲到的回應會被略過）
        $sb = New-Object Text.StringBuilder
        do { $r = $c.ReceiveAsync((New-Object 'System.ArraySegment[byte]' -ArgumentList (, $buf)), $ct).Result; [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Count)) } until ($r.EndOfMessage)
        $o = $sb.ToString() | ConvertFrom-Json
      } until ($o.id -eq $id)
      break
    } catch {
      $script:CdpWs.Remove($target.webSocketDebuggerUrl)      # 連線壞了（例如分頁換了）→ 丟掉，重連再試一次
      if ($attempt -eq 2) { throw }
    }
  }
  if ($o.result.exceptionDetails) { throw ("JS error: " + $o.result.exceptionDetails.text + " " + $o.result.exceptionDetails.exception.description) }
  return $o.result.result.value
}

# 頁面內的小工具：找「看得見」的元素，回傳它在螢幕上的位置（等同人眼看到按鈕在哪）。
$script:JSHELP = @'
const vis = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
const norm = e => e.textContent.replace(/\s+/g, " ").trim();
const T = (sel, t) => [...document.querySelectorAll(sel)].filter(vis).find(e => norm(e).includes(t));
const X = (sel, t) => [...document.querySelectorAll(sel)].filter(vis).find(e => norm(e) === t);
const P = (sel, ph) => [...document.querySelectorAll(sel)].filter(vis).find(e => (e.placeholder || "").includes(ph));
const D = [...document.querySelectorAll(".sheet[role=dialog]")].find(vis);
const I = D ? [...D.querySelectorAll("input")].filter(i => !["date","time","checkbox","file","color"].includes(i.type)) : [];
const R = e => { if (!e) return null; e.scrollIntoView({block: "nearest"}); const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null;
  return {x: window.screenX + r.left + r.width / 2, y: window.screenY + r.top + r.height / 2, l: window.screenX + r.left, t: window.screenY + r.top, w: r.width, h: r.height}; };
'@

function Find-Rect($target, [string]$expr) { Cdp-Eval $target "(() => { $($script:JSHELP) return R($expr); })()" }

# 輪詢等到元素出現且位置穩定（對話框淡入時位置會動，連兩次一致才算數）
function Wait-Rect([scriptblock]$getTarget, [string]$expr, [int]$timeoutMs = 10000) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalMilliseconds -lt $timeoutMs) {
    try {
      $t = & $getTarget
      if ($t) {
        $r1 = Find-Rect $t $expr
        if ($r1) { Start-Sleep -Milliseconds 40; $r2 = Find-Rect $t $expr
          if ($r2 -and [math]::Abs($r1.x - $r2.x) -lt 1.5 -and [math]::Abs($r1.y - $r2.y) -lt 1.5) { return $r2 } }
      }
    } catch { }
    Start-Sleep -Milliseconds 30
  }
  throw "找不到元素（逾時 ${timeoutMs}ms）：$expr"
}
function Wait-Cond([scriptblock]$cond, [int]$timeoutMs = 10000, [string]$what = '條件') {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalMilliseconds -lt $timeoutMs) { try { if (& $cond) { return } } catch { }; Start-Sleep -Milliseconds 60 }
  throw "等待逾時（${timeoutMs}ms）：$what"
}

# 人類節奏的點擊：游標移過去 → 停一下（人的反應時間）→ 按 → 停一下讓畫面反應。
# 移動時間跟距離有關（Fitts 定律的味道）：清單裡相鄰的項目只差幾十像素，不需要 0.35 秒；
# 跨大半個螢幕才給滿 0.35 秒。$moveMs 明確指定時照指定。
function Click-Human([int]$x, [int]$y, [int]$moveMs = -1, [int]$dwell = 130, [int]$settle = 220, [int]$minMove = 140) {
  if ($moveMs -lt 0) {
    $p = Cursor-Pos; $d = [math]::Sqrt(($x - $p[0]) * ($x - $p[0]) + ($y - $p[1]) * ($y - $p[1]))
    $moveMs = [int][math]::Min(350, [math]::Max($minMove, 110 + $d * 0.28))
  }
  Move-Mouse $x $y $moveMs; Start-Sleep -Milliseconds $dwell
  [DemoWin]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60
  [DemoWin]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds $settle
}
# -Fast：連續操作用（下一步本來就會等元素出現，不需要固定的停頓）——移動更短、停頓縮到約 0.06 秒
function Click-Elem([scriptblock]$getTarget, [string]$expr, [int]$timeoutMs = 10000, [switch]$Fast) {
  $r = Wait-Rect $getTarget $expr $timeoutMs
  if ($Fast) { Click-Human ([int]$r.x) ([int]$r.y) -1 60 60 100 } else { Click-Human ([int]$r.x) ([int]$r.y) }
  return $r
}

# ── 介面記憶（localStorage）：跑之前記下來、結束前還原 ──────────────────────────
# 桌面版把「上次選的索引集」「檔案瀏覽器上次的位置」「上次的分頁」這類介面記憶存在網頁的 localStorage，
# 展示會改到它們；不還原的話，使用者下次開啟會看到停在一份已經被刪掉的索引集。
function Get-Storage($target) {
  Cdp-Eval $target '(() => { const o = {}; for (const k of Object.keys(localStorage)) o[k] = localStorage.getItem(k); return JSON.stringify(o); })()'
}
function Restore-Storage($target, [string]$snapshotJson) {
  $lit = ($snapshotJson | ConvertTo-Json -Compress)      # 把 JSON 文字包成 JS 字串字面值
  Cdp-Eval $target "(() => { const snap = JSON.parse($lit); for (const k of Object.keys(localStorage)) if (!(k in snap)) localStorage.removeItem(k); for (const [k, v] of Object.entries(snap)) localStorage.setItem(k, v); return 'ok'; })()" | Out-Null
}
function Storage-Equal([string]$a, [string]$b) {
  $x = @(($a | ConvertFrom-Json).PSObject.Properties | Sort-Object Name); $y = @(($b | ConvertFrom-Json).PSObject.Properties | Sort-Object Name)
  if ($x.Count -ne $y.Count) { return $false }
  for ($i = 0; $i -lt $x.Count; $i++) { if ($x[$i].Name -ne $y[$i].Name -or [string]$x[$i].Value -ne [string]$y[$i].Value) { return $false } }
  return $true
}

# 打字並「讀回來確認」：點進欄位 → 打字 → 讀回欄位實際內容比對；掉字（SendInput 偶發吃掉字元）就全選重打，最多 3 次。
# 不驗證的話，掉了一個字的標題會默默存進資料，後面的等待與清理都對不上。
function Type-Into([scriptblock]$getTarget, [string]$expr, [string]$text, [int]$delay = 30, [switch]$SelectAll) {
  [void](Click-Elem $getTarget $expr)
  $v = $null
  for ($try = 1; $try -le 3; $try++) {
    if ($SelectAll -or $try -gt 1) { Press-Combo @(0x11, 0x41) }
    Type-Text $text $delay
    $t0 = Get-Date
    while (((Get-Date) - $t0).TotalMilliseconds -lt 900) {
      try { $v = Cdp-Eval (& $getTarget) "(() => { $($script:JSHELP) const e = $expr; return e ? e.value : null; })()" } catch { }
      if ($v -ceq $text) { return }
      Start-Sleep -Milliseconds 100
    }
    $msg = "  （打字掉字：預期「$text」實際「$v」，全選重打第 $($try + 1) 次）"
    if (Get-Command Log -ErrorAction SilentlyContinue) { Log $msg } else { Write-Host $msg }
  }
  throw "欄位內容跟預期不符（打了 3 次）：預期「$text」，實際「$v」"
}
