"""集中管理的共用常數 —— 路徑、顏色、字級、限制值。

只在單一模組使用的常數（例如索引範本文字、對話框專屬字級）留在該模組自己
定義，不搬進這裡；這裡只放真的跨模組共用的東西。
"""

from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent.parent
INDEXES_DIR = SCRIPT_DIR / "indexes"

FONT_FAMILY = "Microsoft JhengHei"

COLOR_BG = "#eef2f6"
COLOR_HEADER_BG = "#2c3e50"
COLOR_HEADER_FG = "#ffffff"
COLOR_HEADER_SUB_FG = "#b7c4cf"
COLOR_STATUS_FG = "#5d7285"
COLOR_MISSING_FG = "#c0392b"
COLOR_PREVIEW_BG = "#ffffff"
COLOR_PREVIEW_BORDER = "#c7d3dc"
COLOR_PREVIEW_GRIP_BG = "#c7d3dc"
COLOR_PREVIEW_GRIP_ACTIVE = "#5d7285"

# 功能介紹隱藏列：收合時是一條跟頭部同色系但較淺的提示條，滑鼠移上去／點下去
# 再各深一階，讓「這裡可以點」的意圖清楚，不會跟下面素色的 COLOR_BG 工具列混在一起。
COLOR_HELP_BAR_BG = "#dce8f2"
COLOR_HELP_BAR_HOVER_BG = "#c7dbea"
COLOR_HELP_BAR_FG = "#1f3b52"

# 預覽區塊可以用拉桿橫向調整寬度：320 是預設寬度，最小 220 避免文字/圖示擠成
# 一團看不清楚，最大則是動態算出來的（視窗目前寬度扣掉清單至少要留的寬度），
# 這樣才能真的「拉到視窗左邊邊界」而不會把清單擠到消失或負值報錯。
PREVIEW_DEFAULT_WIDTH = 320
PREVIEW_MIN_WIDTH = 220
TREE_MIN_WIDTH = 80
PREVIEW_GRIP_WIDTH = 16

# 便利貼面板（常駐左側、可收合）：寬度行為比照右側預覽區塊——一樣可以拖曳
# 調整、視窗縮放時夾在最小寬度跟「不擠壓清單」的上限之間；但寬度本身不像
# 分類/資料夾篩選那樣跨次啟動記住（每次啟動都回到預設寬度），只有「上次是
# 展開還是收合」這個開關狀態會存檔——收合與否是使用習慣，寬度多半是當下
# 調整方便瀏覽用的，沒必要跨次保留。
#
# 最小寬度必須至少能放得下標題列的「📌 便利貼」文字＋5 顆圖示按鈕（➕／📝／
# 📤／🗑️／◀）——這排本身（header 這個 Frame）自從改成統一 34px 正方形按鈕
# （見下面 STICKY_ICON_BUTTON_SIZE）之後，自然寬度是 267px；header 是用
# padx=8 包在面板 Frame 裡面（左右各吃掉 8px），面板 Frame 自己還有
# highlightthickness=1 的邊框（左右各 1px），所以真正需要的面板寬度是
# 267 + 8*2 + 1*2 = 285。360／380 這兩個數字是先前用「文字寬度不一的按鈕」
# （4 顆、實測 330px）試出來、蓋過 348 這個底線抓的，換成統一尺寸的按鈕、
# 又多了第 5 顆之後，實際底線降到 285，但兩個常數沒有跟著調降——目前是
# 「比原本用途需要的還寬裕」，不是擠壓問題，所以先保留現有數值，不用急著
# 改小；如果之後想讓面板預設更窄一點，285 是新的安全下限可以參考。
STICKY_PANEL_DEFAULT_WIDTH = 380
STICKY_PANEL_MIN_WIDTH = 360
STICKY_GRIP_WIDTH = 16
STICKY_TOGGLE_SHORTCUT = "Ctrl+Shift+N"

# 標題列 5 顆圖示按鈕（➕／📝／📤／🗑️／◀）固定用這個像素邊長的正方形容器，
# 圖示置中——不同 emoji 本身的字寬差很多（有些帶 variation selector 佔兩個
# code point，字寬明顯比單一 code point 的寬），直接用文字寬度決定按鈕大小
# 會每顆長得不一樣大，所以改成固定尺寸的容器 + 置中文字，不管 emoji 多寬看
# 起來都一樣大。
STICKY_ICON_BUTTON_SIZE = 34

# AI 搜尋每次都會把當時篩選範圍內「全部」便利貼的標題/標籤/內容片段送給
# AI——便利貼數量一多，每次呼叫的內容量／費用會跟著線性增加，使用者又
# 不會自己算 token，超過這個筆數就在送出前的提示視窗多加一句「便利貼較多，
# 建議先用標籤篩選縮小範圍」，不是強制擋下來（便利貼本來就沒有像批次說明
# 那種「使用者逐筆勾選」的介面，硬性砍筆數反而會讓搜尋結果不完整、答非
# 所問），純粹提高警覺、把選擇權留給使用者。
STICKY_AI_SEARCH_LARGE_NOTE_COUNT = 30

# 便利貼卡片配色：色相（hue）直接連續取自標籤字串的雜湊值，落在 0~359 度的
# 色環上（不是從一組固定幾種顏色的色盤裡挑），同一個標籤永遠同一個顏色、
# 不用使用者手動選色；飽和度/亮度固定成偏淡的粉彩色系，跟便利貼的視覺質感
# 一致。沒有標籤的便利貼一律用中性灰，跟色環區隔開來，一眼就能看出「這張
# 沒有分類」。
STICKY_TAG_SATURATION = 0.55
STICKY_TAG_LIGHTNESS = 0.82
STICKY_NEUTRAL_COLOR = "#e5e7eb"
STICKY_CARD_TEXT_COLOR = "#1f2937"

# 卡片邊框改成直接從卡片底色算深一階（見 ui/styles.py 的 darken()），跟著卡片
# 本身的色相走，不用固定灰色；滑鼠移上去時邊框再更深一階＋加粗，當作「這裡
# 可以點」的提示（單擊複製）。折角裝飾用同一色相再更深一階，模擬便利貼被
# 撕下一小角的視覺，純裝飾不影響點擊範圍（折角本身也綁了同樣的點擊事件）。
STICKY_CARD_BORDER_DARKEN = 0.12
STICKY_CARD_HOVER_DARKEN = 0.30
STICKY_CARD_FOLD_DARKEN = 0.20
STICKY_CARD_FOLD_SIZE = 14

# 搜尋／標籤篩選這排比照主視窗工具列既有的「篩選條件」視覺語彙（淡藍底＋
# 藍色邊框），一眼就能認出這是篩選區塊，跟主視窗其他篩選 UI 一致。
STICKY_FILTER_BOX_BG = "#dbeafe"
STICKY_FILTER_BOX_BORDER = "#93c5fd"
STICKY_FILTER_BOX_FG = "#1e3a8a"

# 「已複製」提示做成一個小色塊 toast，只有真的要顯示訊息時才佔位（用
# pack/pack_forget 動態顯示），跟滑鼠提示框（tooltip）分開一組配色。
STICKY_TOAST_BG = "#dcfce7"
STICKY_TOAST_FG = "#166534"
STICKY_TOOLTIP_BG = "#1f2937"
STICKY_TOOLTIP_FG = "#ffffff"

# 預覽內容字級：跟 VS Code 的 Ctrl+=/Ctrl+- 縮放同一種邏輯，Ctrl+0 回到預設值。
PREVIEW_TEXT_DEFAULT_SIZE = 11
PREVIEW_TEXT_MIN_SIZE = 8
PREVIEW_TEXT_MAX_SIZE = 32

# 按鈕配色：不同動作類型各配一種飽和色（現代 Tailwind 風），同一排工具列裡
# 盡量不重複，一眼就能分辨「新增／編輯／刷新／偵測／刪除…」是哪一類動作，
# 不要求每顆按鈕顏色都獨一無二——同一種語意（例如所有對話框的「取消」、
# 所有「確認送出」）維持同色是好的一致性，只有「同一畫面裡功能明顯不同卻
# 撞色」才是要避免的情況。
BTN_PRIMARY_BG = "#16a34a"       # 綠：主要肯定行動（開啟、確認送出、掃描找到）
BTN_PRIMARY_ACTIVE = "#128038"
BTN_SECONDARY_BG = "#475569"     # 石板灰：中性行動（取消、關閉、顯示、全部取消勾選）
BTN_SECONDARY_ACTIVE = "#334155"
BTN_WARN_BG = "#d97706"          # 琥珀：警示／清理類
BTN_WARN_ACTIVE = "#b45f04"
BTN_DANGER_BG = "#dc2626"        # 紅：刪除等破壞性動作
BTN_DANGER_ACTIVE = "#b91c1c"
BTN_BLUE_BG = "#2563eb"          # 藍：新增／建立
BTN_BLUE_ACTIVE = "#1d4ed8"
BTN_TEAL_BG = "#0d9488"          # 青綠：匯入／批次匯入
BTN_TEAL_ACTIVE = "#0b7a6f"
BTN_CYAN_BG = "#0891b2"          # 青：重新整理／更新快取
BTN_CYAN_ACTIVE = "#0e7a91"
BTN_INDIGO_BG = "#4f46e5"        # 靛：編輯類
BTN_INDIGO_ACTIVE = "#4038c7"
BTN_PURPLE_BG = "#7c3aed"        # 紫：補充／生成類
BTN_PURPLE_ACTIVE = "#6423c9"
BTN_ORANGE_BG = "#ea580c"        # 橘：偵測／搜尋類警示
BTN_ORANGE_ACTIVE = "#c2470a"
BTN_PINK_BG = "#db2777"          # 桃紅：複製等次要強調行動
BTN_PINK_ACTIVE = "#b91c5c"

# 「匯入資料夾」「找出未收錄檔案」都是用 rglob 遞迴列出整個資料夾——使用者
# 不小心選到磁碟機根目錄或有幾十萬檔案的資料夾時，掃描本身可能要跑很久。
# 兩層數字搭配 ScanService／掃描進度視窗一起用：
#   SCAN_SOFT_LIMIT：原本可以直接匯入／加入索引的安全筆數。掃描過程中一旦
#     超過，就先暫停跳出對話框問使用者要不要繼續看下去——不管答案是哪個，
#     這次掃描結果都不會拿去寫入索引檔案，只能瀏覽／確認筆數。
#   SCAN_HARD_LIMIT：不管使用者要不要繼續，掃到這裡一定強制停止，避免真的
#     選到磁碟機根目錄時掃描無限跑下去。
SCAN_SOFT_LIMIT = 1_000
SCAN_HARD_LIMIT = 500_000

# 副檔名 → 圖示，純粹方便掃視清單時快速分辨檔案類型，不影響搜尋/開啟邏輯。
EXT_ICON = {
    ".doc": "📄", ".docx": "📄", ".rtf": "📄",
    ".ppt": "📊", ".pptx": "📊",
    ".xls": "📈", ".xlsx": "📈", ".csv": "📈",
    ".pdf": "📕",
    ".txt": "📃", ".md": "📃",
    ".jpg": "🖼️", ".jpeg": "🖼️", ".png": "🖼️", ".gif": "🖼️", ".bmp": "🖼️", ".webp": "🖼️",
    ".mp3": "🎵", ".wav": "🎵", ".flac": "🎵", ".m4a": "🎵",
    ".mp4": "🎬", ".mov": "🎬", ".avi": "🎬", ".mkv": "🎬", ".wmv": "🎬",
    ".zip": "🗜️", ".rar": "🗜️", ".7z": "🗜️",
}
DEFAULT_ICON = "📁"
MISSING_ICON = "⚠️"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}
AUDIO_EXTS = {".mp3", ".wav", ".flac", ".m4a"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".wmv"}
MEDIA_EXTS = AUDIO_EXTS | VIDEO_EXTS

# 右側預覽區塊：純文字類型直接讀檔案內容；docx/pptx/xlsx 用 zipfile 挖出裡面的
# XML 自己解析文字（不需要額外套件）；pdf 則看有沒有裝 pypdf/PyPDF2，沒裝就
# 退回一般圖示，不讓整支程式因為缺套件而掛掉。
TEXT_EXTS = {".txt", ".md", ".csv", ".log", ".json", ".ini", ".yaml", ".yml", ".py"}
PREVIEW_READ_BYTES = 200_000  # 純文字預覽只讀檔案開頭這麼多 bytes，大檔案也不會拖慢介面
OOXML_NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
}

# 匯入資料夾時的副檔名篩選改成按鈕點選（不用手打），每個類型一顆按鈕、各自
# 配一個顏色——(標籤, 圖示, 副檔名集合, 顏色)，順序就是畫面上排列的順序。
EXT_CATEGORIES = [
    ("文件", "📄", {".doc", ".docx", ".rtf"}, "#2874a6"),
    ("簡報", "📊", {".ppt", ".pptx"}, "#ca6f1e"),
    ("試算表", "📈", {".xls", ".xlsx", ".csv"}, "#1e8449"),
    ("PDF", "📕", {".pdf"}, "#c0392b"),
    ("文字", "📃", {".txt", ".md"}, "#616a6b"),
    ("圖片", "🖼️", {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}, "#7d3c98"),
    ("音樂", "🎵", {".mp3", ".wav", ".flac", ".m4a"}, "#148f77"),
    ("影片", "🎬", {".mp4", ".mov", ".avi", ".mkv", ".wmv"}, "#34495e"),
    ("壓縮檔", "🗜️", {".zip", ".rar", ".7z"}, "#8b5a2b"),
]

# 掃描完之後除了看總筆數，還可以依 EXT_CATEGORIES 的九個類別分別看各有幾筆
# （「匯入資料夾」「找出未收錄檔案」掃描完都會用）——顏色沿用同一個類別按鈕
# 的顏色，跟畫面上的類型篩選按鈕對得起來；不屬於任何類別的檔案（例如 .exe、
# .ini）另外歸到「其他」，用中性灰，數量加總起來才會等於總筆數。
CATEGORY_COLOR = {label: color for label, _icon, _exts, color in EXT_CATEGORIES}
OTHER_CATEGORY_LABEL = "其他"
CATEGORY_COLOR[OTHER_CATEGORY_LABEL] = COLOR_STATUS_FG

# 主視窗索引選單裡的「全部索引（跨檔案）」虛擬選項──選到這個代表同時檢視/
# 搜尋全部索引集，不對應任何單一 .md 檔案，所以新增/匯入之類「一定要寫進某
# 一份檔案」的操作在這個模式下會被擋下來，要求先切到指定的索引集。
ALL_INDEXES_LABEL = "🗂 全部索引（跨檔案）"
