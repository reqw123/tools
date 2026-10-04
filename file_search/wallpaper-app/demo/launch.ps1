#requires -Version 5.1
<#
  「啟動-桌面牆自動化展示.bat」的前後台：印說明、選要看的段落和速度、倒數 5 秒、跑 run.ps1、印結果、等按鍵。
  中文訊息放這裡而不是 .bat——cmd 在 chcp 65001 下讀含多位元組字元的批次檔會算錯位置，
  外部程式（powershell）跑完回來後從某行中間接著執行，出現「'o' is not recognized」之類的錯。
  有帶參數就原封不動轉給 run.ps1、不問選單（例如 .bat -Sections index -Speed 0.7）。
  設 DEMO_NOWAIT=1 略過選單、倒數與最後的暫停（全部段落、正常速度）。
#>
$run = Join-Path $PSScriptRoot 'run.ps1'
$noWait = [bool]$env:DEMO_NOWAIT
$runArgs = @($args)

# 段落：代號、名稱、大約秒數（照實測 log 抓的）；開場和結束清理一定會跑（約 15 秒）
# 用 [pscustomobject] 不用純 hashtable：PowerShell 5.1 的 Measure-Object -Property 讀不到 hashtable 的值
$sections = @(
  [pscustomobject]@{ id = 'shell';    name = '桌面牆外殼（右下角控制列：穿透／互動、隱藏／顯示）'; sec = 20 },
  [pscustomobject]@{ id = 'sticky';   name = '便利貼牆（新增、勾待辦、釘選、搜尋、裁切、懸浮、垃圾桶、批次新增／刪除、JSON 匯入、AI 搜尋、匯出 HTML）'; sec = 115 },
  [pscustomobject]@{ id = 'settings'; name = '設定視窗（透明度、到期鬧鐘）'; sec = 15 },
  [pscustomobject]@{ id = 'index';    name = '索引牆（匯入掃描、批次分類、批次補說明、預覽、手動改說明／分類、懸浮播放）'; sec = 100 }
)
$speeds = @(@{ k = '1'; name = '慢'; v = 0.7 }, @{ k = '2'; name = '正常'; v = 1.0 }, @{ k = '3'; name = '快'; v = 1.6 })

Write-Host '============================================================'
Write-Host '  桌面牆 自動化展示'
Write-Host '============================================================'

if (-not $noWait -and $runArgs.Count -eq 0) {
  Write-Host ''
  Write-Host '  要看哪些片段？'
  for ($i = 0; $i -lt $sections.Count; $i++) { Write-Host ('    {0}. {1}　約 {2} 秒' -f ($i + 1), $sections[$i].name, $sections[$i].sec) }
  $pick = $null
  while ($null -eq $pick) {
    $in = Read-Host '  輸入編號（可多選，例如「2 4」；直接按 Enter＝全部）'
    $nums = @([regex]::Matches($in, '\d') | ForEach-Object { [int]$_.Value })
    if (-not $in.Trim()) { $pick = @(1..$sections.Count) }
    elseif ($nums.Count -and -not @($nums | Where-Object { $_ -lt 1 -or $_ -gt $sections.Count }).Count) { $pick = @($nums | Sort-Object -Unique) }
    else { Write-Host "  看不懂「$in」，請輸入 1～$($sections.Count) 的編號。" }
  }
  $sp = $null
  while ($null -eq $sp) {
    $in = Read-Host '  速度？ 1＝慢　2＝正常　3＝快（直接按 Enter＝正常）'
    if (-not $in.Trim()) { $sp = $speeds[1] } else { $sp = $speeds | Where-Object { $_.k -eq $in.Trim() } | Select-Object -First 1 }
    if ($null -eq $sp) { Write-Host '  請輸入 1、2 或 3。' }
  }
  $chosen = @($pick | ForEach-Object { $sections[$_ - 1] })
  $total = 15 + ($chosen | Measure-Object -Property sec -Sum).Sum
  $total = [int]($total / [math]::Sqrt($sp.v))                            # 速度只縮放停頓，不是全程等比例，粗估就好
  $runArgs = @('-Sections', (($chosen | ForEach-Object id) -join ','), '-Speed', $sp.v)
  Write-Host ''
  Write-Host ('  將播放：{0}' -f (($chosen | ForEach-Object { $_.name -replace '（.*$', '' }) -join '、'))
  Write-Host ('  速度：{0}　大約 {1} 分 {2} 秒' -f $sp.name, [int][math]::Floor($total / 60), ($total % 60))
}

Write-Host ''
Write-Host '  展示時滑鼠與鍵盤會被腳本接管，請不要碰。'
Write-Host '  　F8 暫停／繼續　F7 放慢　F9 加快　F12 或動一下滑鼠＝提前結束（一樣會清理）'
Write-Host '  開始前請先關掉桌面牆（右上角 X），以及不想被截圖拍到的視窗。'
Write-Host '  5 秒後自動開始，按任意鍵立即開始，Ctrl+C 取消。'
Write-Host '============================================================'
if (-not $noWait) {
  for ($i = 5; $i -gt 0; $i--) {
    Write-Host -NoNewline "`r  $i 秒後開始… "
    $until = (Get-Date).AddSeconds(1)
    while ((Get-Date) -lt $until) {
      if ([Console]::KeyAvailable) { [void][Console]::ReadKey($true); $i = 0; break }
      Start-Sleep -Milliseconds 50
    }
  }
  Write-Host ''
}

& powershell -NoProfile -ExecutionPolicy Bypass -File $run @runArgs
$rc = $LASTEXITCODE

Write-Host ''
if ($rc -eq 0) { Write-Host '展示完成。' }
elseif ($rc -eq 2) { Write-Host '已提前結束，展示資料已清理、設定已還原。' }
else { Write-Host "展示中止，結束碼 $rc。詳見 wallpaper-app\demo\out\run.log" }
if (-not $noWait) { Write-Host '按任意鍵關閉…'; [void][Console]::ReadKey($true) }
exit $rc
