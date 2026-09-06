"""功能介紹隱藏列——平常只佔一條窄窄的提示條，點一下往下拉開一大塊說明抽屜，
再點一次收合。

展開的說明面板用 place()（不是 pack）浮在其他 widget 上、蓋住下方工具列與
清單，高度直接吃視窗的 75%——這樣「變大」不受其他 widget 版面影響（先前
用 pack+expand 時，視窗高度沒有多餘空間可分，面板就撐不開）。內容本來就
很長，抽屜到底仍看不完的部分交給右側捲軸。收合時 place_forget，完全不佔
空間、也不留版面。

內容本身（_HELP_SUMMARY／_HELP_SECTIONS）只有這個 widget 會用到，所以直接
放在同一個檔案裡，不獨立成另一個模組。
"""

import tkinter as tk
from tkinter import font as tkfont, ttk

from file_search_app.config import (
    BTN_CREATE_BG, BTN_REFRESH_BG, BTN_DANGER_BG, BTN_EDIT_BG, BTN_DETECT_BG, BTN_COPY_BG,
    BTN_PRIMARY_BG, BTN_AI_BG, BTN_SECONDARY_BG, BTN_IMPORT_BG, BTN_WARN_BG,
    COLOR_HEADER_BG, COLOR_HELP_BAR_BG, COLOR_HELP_BAR_FG, COLOR_HELP_BAR_HOVER_BG,
    COLOR_PREVIEW_BG, COLOR_PREVIEW_BORDER, COLOR_STATUS_FG, FONT_FAMILY,
    HELP_FONT_DELTA_MAX, HELP_FONT_DELTA_MIN, INDEXES_DIR,
    SCAN_HARD_LIMIT, SCAN_SOFT_LIMIT, STICKY_AI_SEARCH_LARGE_NOTE_COUNT, STICKY_TOGGLE_SHORTCUT,
)

# 各段落的基準字級（Ctrl 縮放時共用一個 delta 加在這些數字上）與縮排／段距。
# 縮排／段距是「基準字級時的像素值」，縮放時會乘上 (基準desc+delta)/基準desc
# 一起放大縮小，版面比例才不會因為字變大、縮排沒變而擠在一起。
#
# 基準字級一次調成偏大的舒適值（等同舊版 11/12/13pt 再放大 6 級後的樣子），
# 縮排／段距也照同一比例（17/11）一起提高，delta 0 就是「以前手動放大到第 6
# 級」時的版面。想要更精簡的人再用 Ctrl+- 往下調（下限 config.HELP_FONT_DELTA_MIN）。
_HELP_BASE_SIZE = {"summary": 18, "section": 19, "item": 17, "desc": 17}
_HELP_STYLE = {
    "summary": dict(lmargin1=6, lmargin2=6, spacing3=22),
    "section": dict(spacing1=22, spacing3=9),
    "desc": dict(lmargin1=49, lmargin2=49, spacing3=15),
}
_HELP_ITEM_STYLE = dict(spacing1=9, lmargin1=15, lmargin2=49)

# 一句話摘要 + 分區條列。每個項目 (顏色, 名稱, 說明)——顏色直接沿用該按鈕
# 實際的底色常數，色塊跟畫面上真正的按鈕對得起來，使用者才能一眼把「說明
# 列的這一條」跟「畫面上那顆按鈕」連起來；顏色是 None 的項目（下拉選單、
# 快捷鍵之類非按鈕的操作）一律用中性灰點，不強行套顏色。
_HELP_SUMMARY = (
    "這是一個以 indexes/ 內 Markdown 表格為核心的檔案索引工具；程式不會在背景自行掃描硬碟，"
    "只有按下匯入、找出未收錄或更新快取時才讀取指定檔案。可跨索引搜尋、分類／資料夾篩選、"
    "預覽影音與文件、管理索引紀錄、記錄加入時間，並使用 SHA-256 找出內容相同的項目。"
    "\n⚠️ 這支程式的任何刪除／編輯操作，影響範圍都只限於 indexes/ 底下自己的索引紀錄與便利貼"
    "資料本身，絕對不會刪除或修改硬碟上真正的原始檔案。"
)
_HELP_SECTIONS = [
    ("🔍 搜尋與篩選", [
        (None, "索引集（右上角下拉選單）",
         "切換要搜尋哪一份索引檔案；選「🗂 全部索引（跨檔案）」可以同時檢視／搜尋全部索引集，"
         "清單會多一欄「來源索引集」標出每筆屬於哪一份。全部索引模式不能直接新增／匯入資料，"
         "要先切回某一份單一索引集。"),
        (BTN_CREATE_BG, "➕ 新增索引集...",
         f"在 {INDEXES_DIR.name}/ 底下建立一份新的空白索引集（.md 檔案），取名後自動切換過去；"
         "可使用旁邊的刪除按鈕移除目前索引集。"),
        (BTN_CREATE_BG, "📥 匯入索引集...",
         "選一份既有的 .md 檔案（例如從另一台電腦複製過來、或用「匯出索引集」存出去的檔案），"
         "取名後存成一份新的索引集並自動切換過去，內容原封不動帶進來。"),
        (BTN_IMPORT_BG, "📤 匯出索引集...",
         "把目前選取索引集的原始 .md 內容存到你指定的位置，方便手動搬到另一台電腦"
         "（或直接複製 indexes/ 底下的 .md 檔案效果一樣）。"),
        (BTN_DANGER_BG, "🗑️ 刪除索引集",
         "刪除目前選取的索引集、內容快取及加入時間紀錄；會先顯示名稱與筆數要求確認，且不會刪除硬碟上的實體檔案。"),
        (None, "🔍 搜尋框",
         "輸入關鍵字即時篩選序號／檔名／分類／說明／完整路徑／加入時間；更新內容快取後也能搜尋支援格式的檔案內文。"),
        (None, "序號欄",
         "目前索引集依原始排列從 1 開始編號；搜尋或篩選後不會重新編號，批次刪除視窗使用相同流水號。"),
        (None, "分類（下拉選單）",
         "位於淺藍色篩選容器中，只顯示指定分類；選項依目前索引實際內容自動組成。"),
        (None, "資料夾（下拉選單）",
         "位於淺藍色篩選容器中，只顯示指定父資料夾下的索引項目。"),
        (BTN_AI_BG, "🔬 選檔案問 AI...",
         "在資料夾篩選正下方。跟索引無關的即席分析：自選任何一個檔案，送目前「AI 設定」的 Provider "
         "（Ollama 本機／區網電腦，或 OpenAI 雲端）分析，回覆只顯示出來供你查看、可複製，不會寫進任何索引。"
         "送出前的確認視窗會清楚寫明這次送去哪個 Provider／模型、內容會不會離開這台電腦。"),
    ]),
    ("🛠️ 索引管理", [
        (BTN_CREATE_BG, "新增檔案...",
         "可挑選一或多個檔案，逐筆填寫分類／說明後加入目前索引；會排除不存在、重複或已收錄路徑，並記錄加入時間。"),
        (BTN_IMPORT_BG, "匯入資料夾...",
         f"選一整個資料夾，可勾選是否包含子資料夾、依副檔名類型篩選，整批加入索引；已收錄過的檔案會自動略過。"
         f"掃描途中超過 {SCAN_SOFT_LIMIT:,} 筆會先詢問要不要繼續（最多掃到 {SCAN_HARD_LIMIT:,} 筆），"
         f"這種情況下這次掃描結果不能直接匯入。"),
        (BTN_EDIT_BG, "編輯索引檔案",
         "用系統預設程式開啟目前索引集的 .md 檔案，直接手動編輯格式或內容。"),
        (BTN_REFRESH_BG, "重新載入索引",
         "索引 .md 檔案在外部被手動改過時，重新讀取內容，不用重開程式。"),
        (BTN_WARN_BG, "⚠️ 清除失效項目",
         "掃描目前索引，把指向的檔案已經不存在的資料列整批移除。"),
        (BTN_DANGER_BG, "🗑️ 批次刪除...",
         "開啟顯示原始流水號與項目名稱的清單，可用序號或名稱搜尋、勾選目前結果並批次移除；只刪索引紀錄，不刪硬碟檔案。"),
    ]),
    ("🧭 進階工具（批次作業；快取／未收錄／重複偵測會跨全部索引集）", [
        (BTN_REFRESH_BG, "🔄 更新內容快取",
         "重新擷取可讀取的文件內文，供全文搜尋使用；內容雜湊也會一併更新。"),
        (BTN_PRIMARY_BG, "🔎 找出未收錄檔案...",
         f"掃描「常用資料夾清單」（可管理／臨時新增），列出還沒被任何索引集收錄的檔案，勾選後整批加入指定索引集。"
         f"掃描途中超過 {SCAN_SOFT_LIMIT:,} 筆會先詢問要不要繼續（最多掃到 {SCAN_HARD_LIMIT:,} 筆），"
         f"這種情況下這次掃描結果不能直接加入索引；目標索引、分類與收錄按鈕固定在視窗底部。"),
        (BTN_DETECT_BG, "🧬 重複偵測...",
         "按下後會自動重新驗證全部檔案的 SHA-256，再跨索引分組；每組選一筆保留後，只移除其餘索引列，不會刪除實體檔案。"),
        (BTN_AI_BG, "✍️ 批次補說明...",
         "純本機、不呼叫 AI：在背景擷取缺少說明的檔案內容並顯示進度，直接拿內文前段當建議說明；"
         "審核視窗每頁 8 筆，可編輯、調整 14–28pt 字級後批次套用。"),
        (BTN_EDIT_BG, "🤖 AI 批次說明...",
         "跟上面那顆不同，這顆會把檔案內容送給 AI 產生說明。先開一個可搜尋、可勾選的清單"
         "（預設全部不勾選），自己決定要花時間／額度送哪幾筆；送出前一律跳視窗說明這次送幾筆、"
         "粗估內容量、這是全部 AI 功能累計第幾次呼叫。跑完的建議一樣進審核視窗逐筆確認才寫入。"
         "圖片項目會改用視覺模型分析。"),
        (None, "⚙️ AI 設定（在「🤖 AI 批次說明」視窗上方）",
         "AI 相關功能沒有獨立設定按鈕——要先開「🤖 AI 批次說明...」，視窗上方才有「⚙️ AI 設定...」"
         "（工具列上那顆會呼吸的橙色泡泡就是在指這裡）。可選 Ollama（🖥️ 就在這台電腦，或 🌐 區網裡"
         "的另一台電腦）或 OpenAI（雲端、會依用量計費）；「🔬 選檔案問 AI」、便利貼「🤖 AI 搜尋」、"
         "「🤖 AI 批次說明」三者共用這同一份設定，不用分別設定。"),
    ]),
    ("📄 選取項目操作（先在下面清單點選一列）", [
        (BTN_PRIMARY_BG, "📂 開啟檔案",
         "用系統預設程式開啟目前選取的檔案（雙擊清單項目或按 Enter 效果一樣）。"),
        (BTN_SECONDARY_BG, "🗂️ 顯示於檔案總管",
         "打開檔案總管視窗並跳到、選取這個檔案。"),
        (BTN_COPY_BG, "📋 複製路徑",
         "把完整路徑複製到剪貼簿。"),
        (BTN_EDIT_BG, "✏️ 編輯所選列",
         "修改這一筆資料的分類／說明文字。"),
        (BTN_CREATE_BG, "⤒ 第一筆／⤓ 最後一筆",
         "直接選取並捲動到目前結果的第一筆或最後一筆；Home／End、Ctrl+Home／Ctrl+End 也可操作。"),
        (BTN_DANGER_BG, "Delete 刪除所選列",
         "選取列會以藍色標記；按 Delete 後需再次確認，只移除索引紀錄，不刪除硬碟上的實體檔案。"),
    ]),
    ("📌 便利貼（常駐左側面板，記常用指令／網站／備忘）", [
        (None, f"開關面板 {STICKY_TOGGLE_SHORTCUT}", "隨時開關左側便利貼面板；面板上也有「◀」按鈕可以收合。收合後左邊界會留一個「▶」小把手，"
         "點一下即可重新展開，收合狀態會跨次啟動記住。"),
        (BTN_CREATE_BG, "➕ 新增便利貼",
         "標題、內容（可多行，例如一串指令步驟，超過看得到的範圍可以捲動）、標籤（可留空）；"
         "標籤相同的便利貼會自動套用同一個顏色，不用手動選色。"),
        (None, "單擊卡片／右鍵選單",
         "單擊卡片直接把內容複製到剪貼簿；右鍵選單可以複製、編輯、刪除；空白處右鍵也能新增。"),
        (None, "搜尋框與標籤篩選",
         "關鍵字比對標題／內容／標籤（直接打標籤名稱也搜得到）；標籤下拉選單可精確只顯示指定標籤，兩者可以疊加使用。"),
        (BTN_EDIT_BG, "🤖 AI 搜尋",
         "在搜尋框打一般語句（例如「每日必做有哪些事項」「youtube 相關的有幾個」"
         "「目前有哪些分類」），不用打精確關鍵字；會先套用目前的標籤篩選再送出。"
         f"送出前一律先跳視窗顯示「這次送幾則、粗略大小、這是全部 AI 功能累計第幾次呼叫」"
         f"（不管雲端或本機 Provider 都會顯示，便利貼超過 {STICKY_AI_SEARCH_LARGE_NOTE_COUNT} 則"
         "會額外提醒先用標籤篩選縮小範圍）——這是粗略的字元數與次數估計，不是精確 token 數，"
         "實際費用/額度以你的 AI Provider 帳單為準。"),
        (BTN_IMPORT_BG, "📤 匯出",
         "把目前篩選出的清單匯出成 Markdown 文件（標題／標籤／內容各自成段，內容保留原始換行）——給人看的。"),
        (BTN_IMPORT_BG, "💾 匯出資料",
         "把全部便利貼（不受篩選影響）匯出成一份可攜的 JSON 檔——給程式讀回去用，"
         "搬到另一台電腦後用「📥 匯入資料」讀回來就能還原。"),
        (BTN_CREATE_BG, "📥 匯入資料",
         "讀取先前用「💾 匯出資料」匯出的 JSON，合併進目前清單；已經匯入過的（id 相同）會自動略過，不會重複。"),
        (BTN_DANGER_BG, "🗑️ 批次刪除",
         "跳出可搜尋、可勾選的清單批次刪除便利貼；預設全部不勾選，需再次確認才會真的刪除。"),
        (BTN_EDIT_BG, "📝 編輯便利貼檔案",
         "用文字編輯器直接開啟底層的 .sticky_notes.json（進階用途，原始格式，手動編輯請留意別打壞 JSON 結構）。"),
    ]),
    ("💡 其他小技巧", [
        (None, "拖曳檔案", "與「新增檔案...」共用相同驗證與逐筆輸入流程；拖入資料夾會提示改用「匯入資料夾...」。"),
        (None, "加入時間", "新增、拖曳、資料夾匯入或未收錄收錄都會記錄時間（如 8/18 08:00）；既有舊項目顯示「—」。"),
        (None, "影音播放控制列", "選取 MP3／MP4 會直接在預覽區內建播放器（需要系統有 VLC）：▶ 播放／暫停、⏹ 停止、⛶ 大視窗、"
         "時間、可拖曳的進度列與音量列。瀏覽清單不會自動出聲，要按 ▶ 才播。"),
        (None, "影音快捷鍵", "選取 MP3／MP4 後按空白鍵播放／暫停；影片左右鍵倒退／快轉，秒數可在播放列「← → 方向鍵跳轉 N 秒」自行調整（預設 5 秒、跨次啟動記住）。大視窗最高 1280×720，Esc 關閉。"),
        (None, "🎙️ 音訊／影片轉錄", "播放器下方有「🎙️ 轉錄」：用本機語音辨識把 MP3／MP4 的語音轉成文字（需安裝 faster-whisper，"
         "第一次會另外下載模型，可按取消中止）。轉好的文字會寫進內容快取，之後「🔍 搜尋框」也搜得到說了什麼；"
         "按「📝 查看轉錄文字」可切換閱讀，「🔁 重新轉錄」可重跑。純本機處理，內容不會離開這台電腦。"),
        (None, "預覽區塊", "依副檔名類型自動顯示圖片縮圖／文字內容／音樂影片播放；圖片大小跟著預覽區寬度走，文字預覽可用 Ctrl+滾輪縮放字級，Ctrl+0 還原預設大小。"),
        (None, "清單捲動與預覽拉桿", "清單具垂直／水平捲動條；清單與預覽間的 ↔ 拉桿可左右拖曳調整預覽寬度。"),
        (None, "快捷鍵", "Ctrl+F 跳到搜尋框；Esc 清空目前搜尋文字。"),
    ]),
]


class HelpBar:
    def __init__(self, parent, app_prefs=None):
        self._expanded = False
        self._color_tags = set()  # 已經建立過的顏色 tag 名稱，避免重複 tag_configure
        self._app_prefs = app_prefs
        # 字級增減量：跨次啟動記住（app_prefs 省略時就純記憶體、關掉即忘）。
        self._font_delta = app_prefs.load_help_font_delta() if app_prefs else 0
        self._saved_delta = self._font_delta  # 已寫進檔案的值，用來判斷要不要再寫
        self._save_after_id = None            # 延遲寫檔的 after() id
        self._apply_after_id = None           # 延遲套用字型縮放的 after() id

        font_toggle = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")
        self._font_summary = tkfont.Font(family=FONT_FAMILY, size=_HELP_BASE_SIZE["summary"], weight="bold")
        self._font_section = tkfont.Font(family=FONT_FAMILY, size=_HELP_BASE_SIZE["section"], weight="bold")
        self._font_item = tkfont.Font(family=FONT_FAMILY, size=_HELP_BASE_SIZE["item"], weight="bold")
        self._font_desc = tkfont.Font(family=FONT_FAMILY, size=_HELP_BASE_SIZE["desc"])

        self._bar = tk.Frame(parent, bg=COLOR_HELP_BAR_BG, cursor="hand2")
        self._bar.pack(fill="x")
        self._toggle_var = tk.StringVar()
        bar_label = tk.Label(
            self._bar, textvariable=self._toggle_var, bg=COLOR_HELP_BAR_BG, fg=COLOR_HELP_BAR_FG,
            font=font_toggle, anchor="w", cursor="hand2",
        )
        bar_label.pack(side="left", padx=18, pady=7)
        self._set_collapsed_text()

        def _set_bar_bg(color):
            self._bar.configure(bg=color)
            bar_label.configure(bg=color)

        for w in (self._bar, bar_label):
            w.bind("<Button-1>", lambda _e: self.toggle())
            w.bind("<Enter>", lambda _e: _set_bar_bg(COLOR_HELP_BAR_HOVER_BG))
            w.bind("<Leave>", lambda _e: _set_bar_bg(COLOR_HELP_BAR_BG))

        self._parent = parent
        parent.bind("<Configure>", self._on_parent_resize, add="+")
        self._panel = tk.Frame(
            parent, bg=COLOR_PREVIEW_BG, highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
        )
        inner = tk.Frame(self._panel, bg=COLOR_PREVIEW_BG)
        inner.pack(fill="both", expand=True, padx=6, pady=6)

        # 「怎麼縮放這塊說明」的提醒固定釘在面板最上緣、緊接在標題列下方，不隨
        # 內文捲動——這是使用者最可能在「字太小／太大」的當下就地想找的操作，
        # 塞進最底下的條列等於沒說。提示字本身也套用同一顆會縮放的字型。
        self._zoom_hint = tk.Label(
            inner,
            text="🔎 字級：按住 Ctrl 加 ＋／－／0 縮放這塊說明（Ctrl＋滑鼠滾輪也可以），大小會自動記住",
            bg=COLOR_HELP_BAR_BG, fg=COLOR_HELP_BAR_FG, font=self._font_item,
            anchor="w", justify="left", padx=10, pady=5,
        )
        self._zoom_hint.pack(side="top", fill="x", pady=(0, 6))
        self._zoom_hint.bind(
            "<Configure>",
            lambda e: self._zoom_hint.configure(wraplength=max(200, e.width - 20)),
        )

        text = tk.Text(
            inner, wrap="word", relief="flat", bd=0, highlightthickness=0, bg=COLOR_PREVIEW_BG,
            font=self._font_desc, cursor="arrow", height=12, padx=6, pady=4,
        )
        vsb = ttk.Scrollbar(inner, orient="vertical", command=text.yview)
        text.configure(yscrollcommand=vsb.set)
        text.pack(side="left", fill="both", expand=True)
        vsb.pack(side="right", fill="y")
        self._text = text
        self._populate_text()
        text.configure(state="disabled")

        # Ctrl+= / Ctrl+- / Ctrl+0 縮放說明字級（縮排等比例跟著縮放），Ctrl+滾輪
        # 也可以。綁在 toplevel 上：展開中才吃掉這些鍵（回傳 "break"），收合時
        # 回傳 None 讓事件繼續傳到既有的「預覽區字級縮放」全域綁定，兩邊不搶。
        for seq in ("<Control-plus>", "<Control-equal>", "<Control-KP_Add>"):
            parent.bind(seq, lambda _e: self._zoom(1), add="+")
        for seq in ("<Control-minus>", "<Control-KP_Subtract>"):
            parent.bind(seq, lambda _e: self._zoom(-1), add="+")
        for seq in ("<Control-0>", "<Control-KP_0>"):
            parent.bind(seq, lambda _e: self._zoom(0), add="+")
        text.bind("<Control-MouseWheel>", self._on_ctrl_wheel)
        text.bind("<Destroy>", lambda _e: self._on_text_destroy())  # 關程式前補寫一次
        self._apply_font_scale()  # 套用開機時讀回來的 delta

    def _set_collapsed_text(self):
        arrow = "▾" if self._expanded else "▸"
        hint = "再按一次收合" if self._expanded else "點這裡展開"
        self._toggle_var.set(f"{arrow}  ❓ 功能介紹／使用說明（{hint}）")

    def toggle(self):
        self._expanded = not self._expanded
        self._set_collapsed_text()
        if self._expanded:
            self._place_panel()
        else:
            self._panel.place_forget()

    def _place_panel(self):
        """把說明抽屜浮在提示條正下方，寬度滿版、高度吃視窗 75%，蓋住下方
        工具列與清單——關掉就整個收回去。"""
        self._bar.update_idletasks()
        top = self._bar.winfo_y() + self._bar.winfo_height()
        self._panel.place(x=0, y=top, relwidth=1.0, relheight=0.75)
        self._panel.lift()

    def _on_parent_resize(self, event):
        # 視窗縮放時讓抽屜跟著調整；已收合就不管。
        if self._expanded and event.widget is self._parent:
            self._place_panel()

    # ── 字級縮放（Ctrl+= / Ctrl+- / Ctrl+0、Ctrl+滾輪）─────────────────
    def _zoom(self, step):
        """step > 0 放大、< 0 縮小、== 0 回預設。收合狀態不處理，並回傳 None
        讓事件繼續傳給既有的預覽區縮放綁定；展開狀態處理完回傳 "break"。"""
        if not self._expanded:
            return None
        target = 0 if step == 0 else self._font_delta + step
        self._set_font_delta(target)
        return "break"

    def _on_ctrl_wheel(self, event):
        self._set_font_delta(self._font_delta + (1 if event.delta > 0 else -1))
        return "break"

    def _set_font_delta(self, delta):
        delta = max(HELP_FONT_DELTA_MIN, min(HELP_FONT_DELTA_MAX, delta))
        if delta == self._font_delta:
            return
        self._font_delta = delta
        # 連續縮放時只即時更新 delta 數字；實際重設字型／tag（每次都會觸發整份
        # 說明 word-wrap 重排，成本跟顯示行數成正比）延到停手 ~50ms 後合併成
        # 一次做。不然滾輪連滾／Ctrl+= 連按時，每一格 8 次全量重排會塞爆 event
        # loop，畫面一路落後於操作。
        if self._apply_after_id is not None:
            self._text.after_cancel(self._apply_after_id)
        self._apply_after_id = self._text.after(50, self._apply_font_scale_now)
        # 寫檔（原子寫，Windows 上約幾十毫秒）延到停手後再做一次，連續縮放
        # 時才不會每一格都卡一下。
        if self._save_after_id is not None:
            self._text.after_cancel(self._save_after_id)
        self._save_after_id = self._text.after(500, self._flush_font_delta)

    def _apply_font_scale_now(self):
        """debounce 到期後真正套用字型縮放。widget 已被銷毀（關視窗時 after
        還在佇列）就安靜跳過。"""
        self._apply_after_id = None
        try:
            self._apply_font_scale()
        except tk.TclError:
            pass

    def _on_text_destroy(self):
        # 關視窗時把還在佇列的延遲工作取消，並把字級偏好補寫一次。
        for attr in ("_apply_after_id", "_save_after_id"):
            aid = getattr(self, attr)
            if aid is not None:
                try:
                    self._text.after_cancel(aid)
                except tk.TclError:
                    pass
                setattr(self, attr, None)
        self._flush_font_delta()

    def _flush_font_delta(self):
        self._save_after_id = None
        if self._app_prefs and self._saved_delta != self._font_delta:
            try:
                self._app_prefs.save_help_font_delta(self._font_delta)
            except OSError:
                return  # 寫檔失敗只是這次沒存到，字級本身已經套用，不影響使用
            self._saved_delta = self._font_delta

    def _scaled(self, style):
        """把某段落「基準字級時的縮排／段距」乘上目前的字級比例。"""
        k = (_HELP_BASE_SIZE["desc"] + self._font_delta) / _HELP_BASE_SIZE["desc"]
        return {key: round(val * k) for key, val in style.items()}

    def _apply_font_scale(self):
        """縮放時只重設 4 個「有帶字級／縮排」的 tag——每個項目色塊的 tag 只帶
        foreground（不隨字級變），不用一起重設，避免十幾次 tag_configure 各觸發
        一次整份文字重排造成的頓挫。"""
        d = self._font_delta
        self._font_summary.configure(size=_HELP_BASE_SIZE["summary"] + d)
        self._font_section.configure(size=_HELP_BASE_SIZE["section"] + d)
        self._font_item.configure(size=_HELP_BASE_SIZE["item"] + d)
        self._font_desc.configure(size=_HELP_BASE_SIZE["desc"] + d)
        self._text.tag_configure("summary", **self._scaled(_HELP_STYLE["summary"]))
        self._text.tag_configure("section", **self._scaled(_HELP_STYLE["section"]))
        self._text.tag_configure("desc", **self._scaled(_HELP_STYLE["desc"]))
        self._text.tag_configure("item", **self._scaled(_HELP_ITEM_STYLE))

    def _color_tag(self, color):
        """項目色塊的 tag：只負責 foreground（沿用按鈕底色常數，一眼看出這行
        在講哪顆按鈕）。字級／縮排走共用的 "item" tag。"""
        color = color or BTN_SECONDARY_BG
        name = f"c_{color.lstrip('#')}"
        if name not in self._color_tags:
            self._text.tag_configure(name, foreground=color)
            self._color_tags.add(name)
        return name

    def _populate_text(self):
        t = self._text
        t.tag_configure("summary", font=self._font_summary, foreground=COLOR_HEADER_BG)
        t.tag_configure("section", font=self._font_section, foreground=COLOR_HEADER_BG)
        t.tag_configure("desc", font=self._font_desc, foreground=COLOR_STATUS_FG)
        t.tag_configure("item", font=self._font_item)
        self._apply_font_scale()  # 一次把上面 4 個 tag 的縮排／段距設好

        t.insert("end", _HELP_SUMMARY + "\n", "summary")
        for title, items in _HELP_SECTIONS:
            t.insert("end", f"{title}\n", "section")
            for color, label, desc in items:
                bullet = "●" if color else "○"
                t.insert("end", f"{bullet}  {label}\n", ("item", self._color_tag(color)))
                t.insert("end", f"{desc}\n", "desc")
