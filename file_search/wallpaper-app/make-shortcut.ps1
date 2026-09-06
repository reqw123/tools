<#
  在桌面建立 / 更新「桌面便利貼牆」捷徑，圖示用專案內的
  wallpaper-app\assets\shortcut-icon.jpg（會就地轉成同資料夾的 .ico）。

  由 啟動-桌面便利貼牆.bat 每次啟動時呼叫——所以捷徑永遠指向「這個 .bat 目前
  的實際位置」：換電腦、搬資料夾後，只要再跑一次 .bat，桌面捷徑就自己修好，
  不會殘留舊的絕對路徑（Windows .lnk 本質上存的是絕對路徑，靠這支重建來克服）。

  換圖示：把 assets\shortcut-icon.jpg 換成新的圖，再跑一次 .bat 即可（.ico 會
  因為來源比較新而自動重建）。想直接鎖定某個 .ico 也行——放成 assets\
  shortcut-icon.ico、且讓它比 .jpg 新，就不會被覆寫。

  這支失敗不影響主流程：.bat 不檢查它的結束碼。
#>
param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,   # file_search 專案根目錄
  [Parameter(Mandatory = $true)][string]$BatPath        # 啟動-桌面便利貼牆.bat 的完整路徑
)

$ErrorActionPreference = 'Stop'

$assetDir = Join-Path $ProjectRoot 'wallpaper-app\assets'
$srcImg   = Join-Path $assetDir 'shortcut-icon.jpg'
$outIco   = Join-Path $assetDir 'shortcut-icon.ico'

function Convert-ImageToIco {
  param([string]$Src, [string]$Dst)

  Add-Type -AssemblyName System.Drawing

  $img = [System.Drawing.Image]::FromFile($Src)
  try {
    # 先置中裁成正方形，再縮各種尺寸——來源是橫幅照片，直接塞會變形。
    $side = [Math]::Min($img.Width, $img.Height)
    $sx = [int](($img.Width  - $side) / 2)
    $sy = [int](($img.Height - $side) / 2)

    $square = New-Object System.Drawing.Bitmap($side, $side)
    $sg = [System.Drawing.Graphics]::FromImage($square)
    $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $srcRect = New-Object System.Drawing.Rectangle($sx, $sy, $side, $side)
    $dstRect = New-Object System.Drawing.Rectangle(0, 0, $side, $side)
    $sg.DrawImage($img, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $sg.Dispose()

    $sizes = @(16, 24, 32, 48, 64, 128, 256)
    $pngs = New-Object System.Collections.Generic.List[byte[]]
    foreach ($s in $sizes) {
      $bmp = New-Object System.Drawing.Bitmap($s, $s)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode  = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.DrawImage($square, 0, 0, $s, $s)
      $g.Dispose()
      $ms = New-Object System.IO.MemoryStream
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $pngs.Add($ms.ToArray())
      $ms.Dispose(); $bmp.Dispose()
    }
    $square.Dispose()

    # ICO 容器：ICONDIR(6) + ICONDIRENTRY(16)×N + 各筆 PNG 資料。
    # 每筆用 Vista 以後支援的 PNG 壓縮格式，256px 那筆寬高欄位填 0（＝256）。
    $fs = [System.IO.File]::Create($Dst)
    $bw = New-Object System.IO.BinaryWriter($fs)
    try {
      $bw.Write([UInt16]0)              # reserved
      $bw.Write([UInt16]1)              # type = icon
      $bw.Write([UInt16]$sizes.Count)   # 圖數
      $offset = 6 + 16 * $sizes.Count
      for ($i = 0; $i -lt $sizes.Count; $i++) {
        $s = $sizes[$i]
        $data = $pngs[$i]
        $dim = [byte]($(if ($s -ge 256) { 0 } else { $s }))
        $bw.Write($dim)                 # width
        $bw.Write($dim)                 # height
        $bw.Write([byte]0)             # palette count
        $bw.Write([byte]0)             # reserved
        $bw.Write([UInt16]1)           # colour planes
        $bw.Write([UInt16]32)          # bits per pixel
        $bw.Write([UInt32]$data.Length)
        $bw.Write([UInt32]$offset)
        $offset += $data.Length
      }
      foreach ($data in $pngs) { $bw.Write($data) }
    }
    finally {
      $bw.Dispose(); $fs.Dispose()
    }
  }
  finally {
    $img.Dispose()
  }
}

# ── 需要的話（重）建 .ico ────────────────────────────────────────────
$iconLocation = $null
if (Test-Path -LiteralPath $srcImg) {
  $needBuild = $true
  if (Test-Path -LiteralPath $outIco) {
    $needBuild = (Get-Item -LiteralPath $srcImg).LastWriteTimeUtc -gt (Get-Item -LiteralPath $outIco).LastWriteTimeUtc
  }
  if ($needBuild) {
    try {
      Convert-ImageToIco -Src $srcImg -Dst $outIco
      Write-Host "[shortcut] 圖示已重建：$outIco"
    }
    catch {
      Write-Warning "[shortcut] 圖示轉檔失敗（改用預設圖示）：$($_.Exception.Message)"
    }
  }
}
if (Test-Path -LiteralPath $outIco) { $iconLocation = "$outIco,0" }

# ── 建立 / 更新桌面捷徑 ─────────────────────────────────────────────
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop '桌面便利貼牆.lnk'

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath       = $BatPath
$lnk.WorkingDirectory = $ProjectRoot
$lnk.Description       = '桌面便利貼牆 / 檔案索引牆（Shift+Z 切換互動/背景）'
# .bat 自己會判斷要不要躲進背景（已裝好/建置過就整個隱藏執行，改用畫面右上角
# 的關閉鈕結束，不再需要靠這個主控台）；這裡設成 7（最小化）只是保險——萬一
# 真的要跑安裝/建置，至少視窗一開始是縮到工作列，不會跳出來搶最前面。
$lnk.WindowStyle      = 7
if ($iconLocation) { $lnk.IconLocation = $iconLocation }
$lnk.Save()

Write-Host "[shortcut] 桌面捷徑已就緒：$lnkPath"
