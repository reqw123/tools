# 展示腳本的底層工具：真實滑鼠／鍵盤（user32）、截圖、列出桌面牆視窗。
# 存檔一定要帶 UTF-8 BOM——Windows PowerShell 5.1 讀沒有 BOM 的 .ps1 會當成 ANSI，中文全部亂碼（見 ../rebuild-if-stale.ps1 的說明）。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
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
# 使用者介入的偵測（暫停／調速／提前結束）放在背景執行緒，每 10ms 看一次：
#   - 按鍵：PowerShell 主迴圈忙著做別的事時（等網頁、點擊之間）短短按一下會整個漏掉，所以由執行緒「記下按過幾次」，
#     主迴圈有空時再 Take() 取走。
#   - 滑鼠：游標偏離「腳本最後放的位置」就是有人在動。腳本移動游標一律走 MoveTo()（先記預期位置再移），
#     執行緒同時接受上一個與這一個預期位置，避免「剛記好還沒移過去」那一瞬間誤判。
#     只在 Arm() 之後才偵測；暫停時 Disarm()，繼續時 Arm() 從當下位置重新起算。
if (-not ([System.Management.Automation.PSTypeName]'DemoKeys').Type) {
Add-Type @"
using System; using System.Threading; using System.Runtime.InteropServices;
public static class DemoKeys {
  [StructLayout(LayoutKind.Sequential)] struct PT { public int X, Y; }
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out PT p);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  static volatile bool prompt;
  static readonly int[] watch = { 0x76, 0x77, 0x78, 0x7B };   // F7 F8 F9 F12
  static readonly int[] count = new int[256]; static readonly bool[] down = new bool[256];
  static int ex = int.MinValue, ey, px = int.MinValue, py, moved; static volatile bool armed;
  static Thread th; static readonly object gate = new object();
  public static void Start() {
    if (th != null) return;
    th = new Thread(() => { while (true) {
      foreach (var vk in watch) { bool d = (GetAsyncKeyState(vk) & 0x8000) != 0; if (d && !down[vk]) Interlocked.Increment(ref count[vk]); down[vk] = d; }
      if (armed) { PT p; GetCursorPos(out p); lock (gate) {
        bool nearE = ex != int.MinValue && Math.Abs(p.X - ex) <= 40 && Math.Abs(p.Y - ey) <= 40;
        bool nearP = px != int.MinValue && Math.Abs(p.X - px) <= 40 && Math.Abs(p.Y - py) <= 40;
        if (ex != int.MinValue && !nearE && !nearP) moved = 1; } }
      // Windows 系統提示（例如換電腦第一次執行時的防火牆詢問「是否允許網路存取」）——它會搶走焦點，點擊打不進桌面牆
      var hp = FindWindow("Shell_SystemDialogProxy", null); prompt = hp != IntPtr.Zero && IsWindowVisible(hp);
      Thread.Sleep(10); } });
    th.IsBackground = true; th.Start();
  }
  public static int Take(int vk) { return Interlocked.Exchange(ref count[vk], 0); }
  public static void MoveTo(int x, int y) { lock (gate) { px = ex; py = ey; ex = x; ey = y; } SetCursorPos(x, y); }
  public static bool TakeMoved() { return Interlocked.Exchange(ref moved, 0) == 1; }
  public static void Arm() { PT p; GetCursorPos(out p); lock (gate) { ex = p.X; ey = p.Y; px = ex; py = ey; moved = 0; } armed = true; }
  public static void Disarm() { armed = false; }
  public static bool SystemPrompt() { return prompt; }
}
"@
}
[DemoKeys]::Start()

# 使用者介入檢查——預設什麼都不做，run.ps1 會覆寫成真正的檢查。移動滑鼠、打字、等待（cdp.ps1）的迴圈裡都會呼叫。
function Check-User { }

function Cursor-Pos { $p = New-Object DemoWin+POINT; [void][DemoWin]::GetCursorPos([ref]$p); return @($p.X, $p.Y) }
function Move-Mouse([int]$x, [int]$y, [int]$ms = 700) {
  Check-User
  $s = Cursor-Pos; $steps = [Math]::Max(12, [int]($ms / 14))
  for ($i = 1; $i -le $steps; $i++) { $t = $i / $steps; $e = $t * $t * (3 - 2 * $t)
    [DemoKeys]::MoveTo([int]($s[0] + ($x - $s[0]) * $e), [int]($s[1] + ($y - $s[1]) * $e)); Start-Sleep -Milliseconds 14; Check-User }
  [DemoKeys]::MoveTo($x, $y)
}
function Click-At([int]$x, [int]$y, [int]$ms = 700) {
  Move-Mouse $x $y $ms; Start-Sleep -Milliseconds 180
  [DemoWin]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 70
  [DemoWin]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 250
}
function Drag-Mouse([int]$x1, [int]$y1, [int]$x2, [int]$y2, [int]$ms = -1) {
  # 游標已經在起點（呼叫前先移過去確認過游標形狀）就不再重新移動；拖曳時間預設依距離（約 0.25～0.8 秒）
  $p = Cursor-Pos
  if ([math]::Abs($p[0] - $x1) -gt 3 -or [math]::Abs($p[1] - $y1) -gt 3) { Move-Mouse $x1 $y1 500; Start-Sleep -Milliseconds 120 }
  if ($ms -lt 0) { $d = [math]::Sqrt(($x2 - $x1) * ($x2 - $x1) + ($y2 - $y1) * ($y2 - $y1)); $ms = [int][math]::Min(800, [math]::Max(250, 150 + $d * 0.6)) }
  [DemoWin]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80
  Move-Mouse $x2 $y2 $ms; Start-Sleep -Milliseconds 100
  [DemoWin]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 150
}
function Type-Text([string]$s, [int]$delay = 45) { foreach ($c in $s.ToCharArray()) { Check-User; [DemoWin]::TypeChar($c); Start-Sleep -Milliseconds $delay } }
function Press-Combo([byte[]]$vks) {
  foreach ($k in $vks) { [DemoWin]::keybd_event($k, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40 }
  $rev = $vks.Clone(); [Array]::Reverse($rev)                            # 反轉副本——不能動到呼叫端的陣列（同一組快捷鍵會重複使用）
  foreach ($k in $rev) { [DemoWin]::keybd_event($k, 0, 2, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40 }
}
function Shot([string]$name) {
  $dir = Join-Path $PSScriptRoot 'out\shots'; if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $sb = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds                # 實際螢幕大小（不是寫死 1920×1080）
  $bmp = New-Object Drawing.Bitmap $sb.Width, $sb.Height
  $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($sb.X, $sb.Y, 0, 0, $bmp.Size)
  $sw = 1280; $sh = [int](1280 * $sb.Height / $sb.Width)
  $small = New-Object Drawing.Bitmap $sw, $sh
  $g2 = [Drawing.Graphics]::FromImage($small); $g2.InterpolationMode = 'HighQualityBicubic'; $g2.DrawImage($bmp, 0, 0, $sw, $sh)
  $path = Join-Path $dir "$name.png"; $small.Save($path, [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $g2.Dispose(); $bmp.Dispose(); $small.Dispose(); return $path
}
function App-Pid { $p = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*wallpaper-app*' } | Sort-Object StartTime | Select-Object -First 1; if ($p) { $p.Id } }
function App-Windows { $id = App-Pid; if ($id) { [DemoWin]::Windows([uint32]$id) } }


# ── 字幕條：每一步展示什麼功能，顯示在螢幕下方正中央 ─────────────────────────────
# 獨立的 Win32 視窗（不是畫在桌面牆網頁裡）：牆會切穿透／隱藏／裁切、會換成索引牆，網頁內的 DOM 撐不過這些；
# 獨立視窗才能整場都在。滑鼠穿透（WS_EX_TRANSPARENT）＋不搶焦點（WS_EX_NOACTIVATE），不影響真實滑鼠鍵盤操作；
# 桌面牆的視窗也是最上層，會互相搶，所以每 300ms 重新宣告一次 TOPMOST。自己一條 STA 執行緒跑訊息迴圈。
if (-not ([System.Management.Automation.PSTypeName]'DemoCaption').Type) {
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing @"
using System; using System.Drawing; using System.Drawing.Drawing2D; using System.Drawing.Text;
using System.Threading; using System.Windows.Forms; using System.Runtime.InteropServices;
public class DemoCaption : Form {
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  static DemoCaption inst; static readonly ManualResetEvent ready = new ManualResetEvent(false);
  string kicker = "", title = "", desc = "", hint = ""; double fade = 1;
  System.Windows.Forms.Timer topTimer, fadeTimer;
  readonly Font fKick = new Font("Microsoft JhengHei UI", 10.5f, FontStyle.Bold);
  readonly Font fTitle = new Font("Microsoft JhengHei UI", 17f, FontStyle.Bold);
  readonly Font fDesc = new Font("Microsoft JhengHei UI", 11.5f);
  readonly Font fHint = new Font("Microsoft JhengHei UI", 9.5f);
  protected override CreateParams CreateParams { get {
    var cp = base.CreateParams; cp.ExStyle |= 0x80000 | 0x20 | 0x80 | 0x8000000 | 0x8; return cp; } }  // LAYERED|TRANSPARENT|TOOLWINDOW|NOACTIVATE|TOPMOST
  protected override bool ShowWithoutActivation { get { return true; } }
  DemoCaption(Rectangle r) {
    FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
    Bounds = r; BackColor = Color.FromArgb(28, 24, 18); Opacity = 0.94; DoubleBuffered = true;
    var path = new GraphicsPath(); int d = 28;
    path.AddArc(0, 0, d, d, 180, 90); path.AddArc(r.Width - d, 0, d, d, 270, 90);
    path.AddArc(r.Width - d, r.Height - d, d, d, 0, 90); path.AddArc(0, r.Height - d, d, d, 90, 90); path.CloseFigure();
    Region = new Region(path);
    topTimer = new System.Windows.Forms.Timer { Interval = 300 };
    topTimer.Tick += (s, e) => SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 | 0x0040);
    topTimer.Start();
    fadeTimer = new System.Windows.Forms.Timer { Interval = 16 };
    fadeTimer.Tick += (s, e) => { fade = Math.Min(1, fade + 0.08); Invalidate(); if (fade >= 1) fadeTimer.Stop(); };
  }
  protected override void OnPaint(PaintEventArgs e) {
    var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
    int a = (int)(255 * fade), pad = 26;
    using (var accent = new SolidBrush(Color.FromArgb(208, 167, 95))) g.FillRectangle(accent, 0, 0, 6, Height);  // 黃銅色左邊條
    using (var bk = new SolidBrush(Color.FromArgb(a, 208, 167, 95))) g.DrawString(kicker, fKick, bk, pad, 12);
    using (var bh = new SolidBrush(Color.FromArgb(150, 160, 150))) {   // 右上角：操作提示（暫停／調速／結束），不跟著淡入
      var sz = g.MeasureString(hint, fHint); g.DrawString(hint, fHint, bh, Width - pad - sz.Width, 13); }
    using (var bt = new SolidBrush(Color.FromArgb(a, 246, 241, 231))) g.DrawString(title, fTitle, bt, pad - 2, 32);
    using (var bd = new SolidBrush(Color.FromArgb(a, 200, 190, 172)))
      g.DrawString(desc, fDesc, bd, new RectangleF(pad, 68, Width - pad * 2, Height - 72));
  }
  void SetText(string k, string t, string d) { kicker = k; title = t; desc = d; fade = 0.15; Invalidate(); fadeTimer.Start(); }
  public static void Start(int x, int y, int w, int h) {
    if (inst != null) return;
    var th = new Thread(() => { inst = new DemoCaption(new Rectangle(x, y, w, h)); inst.Shown += (s, e) => ready.Set(); Application.Run(inst); });
    th.SetApartmentState(ApartmentState.STA); th.IsBackground = true; th.Start(); ready.WaitOne(5000);
  }
  public static void Hint(string h) { var f = inst; if (f != null && f.IsHandleCreated) f.BeginInvoke((Action)(() => { f.hint = h; f.Invalidate(); })); }
  public static void Set(string k, string t, string d) { var f = inst; if (f != null && f.IsHandleCreated) f.BeginInvoke((Action)(() => f.SetText(k, t, d))); }
  public static void Stop() { var f = inst; inst = null; if (f != null && f.IsHandleCreated) f.BeginInvoke((Action)(() => f.Close())); }
}
"@
}
function Caption-Start {
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $w = [math]::Min(1040, $wa.Width - 80); $h = 118
  [DemoCaption]::Start([int]($wa.X + ($wa.Width - $w) / 2), [int]($wa.Bottom - $h - 26), $w, $h)
}
function Caption-Set([string]$kicker, [string]$title, [string]$desc) { [DemoCaption]::Set($kicker, $title, $desc) }
function Caption-Hint([string]$hint) { [DemoCaption]::Hint($hint) }
function Caption-Stop { [DemoCaption]::Stop() }

# ── 右側常駐說明：對原始檔案唯讀 ────────────────────────────────────────────────
# 跟字幕條同一種視窗（滑鼠穿透、不搶焦點、定時重新置頂），整場固定在螢幕右側中間。
# 文字內容是對使用者的承諾，改之前先確認程式真的做到（見 README「右側常駐說明」）。
if (-not ([System.Management.Automation.PSTypeName]'DemoNotice').Type) {
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing @"
using System; using System.Drawing; using System.Drawing.Drawing2D; using System.Drawing.Text;
using System.Threading; using System.Windows.Forms; using System.Runtime.InteropServices;
public class DemoNotice : Form {
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  static DemoNotice inst; static readonly ManualResetEvent ready = new ManualResetEvent(false);
  readonly string head, body;
  readonly Font fHead = new Font("Microsoft JhengHei UI", 13f, FontStyle.Bold);
  readonly Font fBody = new Font("Microsoft JhengHei UI", 10.5f);
  readonly Font fTag = new Font("Microsoft JhengHei UI", 9f, FontStyle.Bold);
  protected override CreateParams CreateParams { get {
    var cp = base.CreateParams; cp.ExStyle |= 0x80000 | 0x20 | 0x80 | 0x8000000 | 0x8; return cp; } }
  protected override bool ShowWithoutActivation { get { return true; } }
  DemoNotice(Rectangle r, string h, string b) {
    head = h; body = b;
    FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
    Bounds = r; BackColor = Color.FromArgb(24, 33, 28); Opacity = 0.93; DoubleBuffered = true;
    var path = new GraphicsPath(); int d = 24;
    path.AddArc(0, 0, d, d, 180, 90); path.AddArc(r.Width - d, 0, d, d, 270, 90);
    path.AddArc(r.Width - d, r.Height - d, d, d, 0, 90); path.AddArc(0, r.Height - d, d, d, 90, 90); path.CloseFigure();
    Region = new Region(path);
    var t = new System.Windows.Forms.Timer { Interval = 300 };
    t.Tick += (s, e) => SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 | 0x0040);
    t.Start();
  }
  protected override void OnPaint(PaintEventArgs e) {
    var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
    int pad = 20;
    using (var accent = new SolidBrush(Color.FromArgb(94, 196, 140))) g.FillRectangle(accent, 0, 0, 5, Height);   // 綠色左邊條＝安全
    using (var tag = new SolidBrush(Color.FromArgb(94, 196, 140))) g.DrawString("安心使用", fTag, tag, pad, 14);
    using (var bh = new SolidBrush(Color.FromArgb(240, 246, 241))) g.DrawString(head, fHead, bh, pad - 2, 32);
    using (var bb = new SolidBrush(Color.FromArgb(196, 210, 200)))
      g.DrawString(body, fBody, bb, new RectangleF(pad, 64, Width - pad * 2, Height - 72));
  }
  public static void Start(int x, int y, int w, int h, string head, string body) {
    if (inst != null) return;
    var th = new Thread(() => { inst = new DemoNotice(new Rectangle(x, y, w, h), head, body); inst.Shown += (s, e) => ready.Set(); Application.Run(inst); });
    th.SetApartmentState(ApartmentState.STA); th.IsBackground = true; th.Start(); ready.WaitOne(5000);
  }
  public static void Stop() { var f = inst; inst = null; if (f != null && f.IsHandleCreated) f.BeginInvoke((Action)(() => f.Close())); }
}
"@
}
function Notice-Start([string]$head, [string]$body) {
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $w = 300; $h = 196
  [DemoNotice]::Start([int]($wa.Right - $w - 18), [int]($wa.Y + $wa.Height * 0.30), $w, $h, $head, $body)
}
function Notice-Stop { [DemoNotice]::Stop() }

# ── Windows 原生檔案對話框（開啟／另存新檔）─────────────────────────────────────
# 網頁的 <input type=file> 與下載會跳出系統對話框，它不是網頁、除錯埠看不到——用視窗類別 #32770 找。
if (-not ([System.Management.Automation.PSTypeName]'DemoDlg').Type) {
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class DemoDlg {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  // 回傳第一個看得見的系統對話框標題（找不到回 null）；順便把它帶到前景，接下來的鍵盤輸入才會打進去
  public static string Find() {
    string found = null;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var c = new StringBuilder(64); GetClassName(h, c, 64);
      if (c.ToString() != "#32770") return true;
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      found = t.ToString(); SetForegroundWindow(h); return false;
    }, IntPtr.Zero);
    return found;
  }
}
"@
}
# 等系統檔案對話框出現 → 在檔名欄打完整路徑 → Enter。路徑要用純 ASCII（中文路徑會被輸入法攔截打錯）。
function FileDialog-Enter([string]$path, [int]$timeoutMs = 10000) {
  if ($path -match '[^\x20-\x7E]') { throw "檔案對話框的路徑必須是純英數（輸入法會攔截中文）：$path" }
  $t0 = Get-Date; $title = $null
  while (-not ($title = [DemoDlg]::Find())) {
    if (((Get-Date) - $t0).TotalMilliseconds -gt $timeoutMs) { throw '等不到系統檔案對話框' }
    Check-User; Start-Sleep -Milliseconds 100
  }
  Start-Sleep -Milliseconds 600                                           # 對話框剛出現時檔名欄還沒拿到焦點
  Press-Combo @(0x11, 0x41)                                               # 全選檔名欄裡的預設檔名，直接覆蓋
  Type-Text $path 18
  Start-Sleep -Milliseconds 300
  Press-Combo @(0x0D)
  $t0 = Get-Date
  while ([DemoDlg]::Find()) {
    if (((Get-Date) - $t0).TotalMilliseconds -gt 5000) { throw "系統檔案對話框沒有關掉（$title）" }
    Start-Sleep -Milliseconds 100
  }
  return $title
}
