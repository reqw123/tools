# 展示腳本的底層工具：真實滑鼠／鍵盤（user32）、截圖、列出桌面牆視窗。
# 存檔一定要帶 UTF-8 BOM——Windows PowerShell 5.1 讀沒有 BOM 的 .ps1 會當成 ANSI，中文全部亂碼（見 ../rebuild-if-stale.ps1 的說明）。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
if (-not ([System.Management.Automation.PSTypeName]'DemoWin').Type) {
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class DemoWin {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public KEYBDINPUT ki; public long pad; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr e);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  public static List<string> Windows(uint pid) {
    var res = new List<string>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h)) {
        RECT r; GetWindowRect(h, out r);
        var sb = new StringBuilder(64); GetClassName(h, sb, 64);
        if (sb.ToString() == "Chrome_WidgetWin_1")
          res.Add(string.Format("{0} {1} {2} {3} {4} ex=0x{5:X}", h.ToInt64(), r.L, r.T, r.R - r.L, r.B - r.T, GetWindowLong(h, -20)));
      }
      return true;
    }, IntPtr.Zero);
    return res;
  }
  public static void TypeChar(char c) {
    var a = new INPUT[2];
    a[0].type = 1; a[0].ki.scan = c; a[0].ki.flags = 0x0004;
    a[1].type = 1; a[1].ki.scan = c; a[1].ki.flags = 0x0004 | 0x0002;
    SendInput(2, a, System.Runtime.InteropServices.Marshal.SizeOf(typeof(INPUT)));
  }
}
"@
}
[void][DemoWin]::SetProcessDPIAware()

function Cursor-Pos { $p = New-Object DemoWin+POINT; [void][DemoWin]::GetCursorPos([ref]$p); return @($p.X, $p.Y) }
function Move-Mouse([int]$x, [int]$y, [int]$ms = 700) {
  $s = Cursor-Pos; $steps = [Math]::Max(12, [int]($ms / 14))
  for ($i = 1; $i -le $steps; $i++) { $t = $i / $steps; $e = $t * $t * (3 - 2 * $t)
    [void][DemoWin]::SetCursorPos([int]($s[0] + ($x - $s[0]) * $e), [int]($s[1] + ($y - $s[1]) * $e)); Start-Sleep -Milliseconds 14 }
  [void][DemoWin]::SetCursorPos($x, $y)
}
function Click-At([int]$x, [int]$y, [int]$ms = 700) {
  Move-Mouse $x $y $ms; Start-Sleep -Milliseconds 180
  [DemoWin]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 70
  [DemoWin]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 250
}
function Drag-Mouse([int]$x1, [int]$y1, [int]$x2, [int]$y2, [int]$ms = 900) {
  Move-Mouse $x1 $y1 600; Start-Sleep -Milliseconds 200
  [DemoWin]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 180
  Move-Mouse $x2 $y2 $ms; Start-Sleep -Milliseconds 250
  [DemoWin]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 350
}
function Type-Text([string]$s, [int]$delay = 45) { foreach ($c in $s.ToCharArray()) { [DemoWin]::TypeChar($c); Start-Sleep -Milliseconds $delay } }
function Press-Combo([byte[]]$vks) {
  foreach ($k in $vks) { [DemoWin]::keybd_event($k, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40 }
  [Array]::Reverse($vks)
  foreach ($k in $vks) { [DemoWin]::keybd_event($k, 0, 2, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40 }
}
function Shot([string]$name) {
  $dir = Join-Path $PSScriptRoot 'out\shots'; if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $bmp = New-Object Drawing.Bitmap 1920, 1080
  $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0, 0, 0, 0, $bmp.Size)
  $small = New-Object Drawing.Bitmap 1280, 720
  $g2 = [Drawing.Graphics]::FromImage($small); $g2.InterpolationMode = 'HighQualityBicubic'; $g2.DrawImage($bmp, 0, 0, 1280, 720)
  $path = Join-Path $dir "$name.png"; $small.Save($path, [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $g2.Dispose(); $bmp.Dispose(); $small.Dispose(); return $path
}
function App-Pid { $p = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*wallpaper-app*' } | Sort-Object StartTime | Select-Object -First 1; if ($p) { $p.Id } }
function App-Windows { $id = App-Pid; if ($id) { [DemoWin]::Windows([uint32]$id) } }
