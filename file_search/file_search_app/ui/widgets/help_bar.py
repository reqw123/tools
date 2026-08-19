"""功能介紹隱藏列——平常只佔一條窄窄的提示條，點一下往下展開一塊說明面板，
再點一次收合；用 pack(after=...) 把展開的面板插在提示條跟下面工具列之間，
收合時完全不佔空間，不用另外騰版面給新手教學用的內容。

內容本身（_HELP_SUMMARY／_HELP_SECTIONS）只有這個 widget 會用到，所以直接
放在同一個檔案裡，不獨立成另一個模組。
"""

import tkinter as tk
from tkinter import font as tkfont, ttk

from file_search_app.config import (
    BTN_BLUE_BG, BTN_CYAN_BG, BTN_DANGER_BG, BTN_INDIGO_BG, BTN_ORANGE_BG, BTN_PINK_BG,
    BTN_PRIMARY_BG, BTN_PURPLE_BG, BTN_SECONDARY_BG, BTN_TEAL_BG, BTN_WARN_BG,
    COLOR_HEADER_BG, COLOR_HELP_BAR_BG, COLOR_HELP_BAR_FG, COLOR_HELP_BAR_HOVER_BG,
    COLOR_PREVIEW_BG, COLOR_PREVIEW_BORDER, COLOR_STATUS_FG, FONT_FAMILY, INDEXES_DIR,
    SCAN_HARD_LIMIT, SCAN_SOFT_LIMIT,
)

# 一句話摘要 + 分區條列。每個項目 (顏色, 名稱, 說明)——顏色直接沿用該按鈕
# 實際的底色常數，色塊跟畫面上真正的按鈕對得起來，使用者才能一眼把「說明
# 列的這一條」跟「畫面上那顆按鈕」連起來；顏色是 None 的項目（下拉選單、
# 快捷鍵之類非按鈕的操作）一律用中性灰點，不強行套顏色。
_HELP_SUMMARY = (
    "這是一個以 indexes/ 內 Markdown 表格為核心的檔案索引工具；程式不會在背景自行掃描硬碟，"
    "只有按下匯入、找出未收錄或更新快取時才讀取指定檔案。可跨索引搜尋、分類／資料夾篩選、"
    "預覽影音與文件、管理索引紀錄、記錄加入時間，並使用 SHA-256 找出內容相同的項目。"
)
_HELP_SECTIONS = [
    ("🔍 搜尋與篩選", [
        (None, "索引集（右上角下拉選單）",
         "切換要搜尋哪一份索引檔案；選「🗂 全部索引（跨檔案）」可以同時檢視／搜尋全部索引集。"),
        (BTN_BLUE_BG, "➕ 新增索引集...",
         f"在 {INDEXES_DIR.name}/ 底下建立一份新的空白索引集（.md 檔案），取名後自動切換過去；"
         "可使用旁邊的刪除按鈕移除目前索引集。"),
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
    ]),
    ("🛠️ 索引管理", [
        (BTN_BLUE_BG, "新增檔案...",
         "可挑選一或多個檔案，逐筆填寫分類／說明後加入目前索引；會排除不存在、重複或已收錄路徑，並記錄加入時間。"),
        (BTN_TEAL_BG, "匯入資料夾...",
         f"選一整個資料夾，可勾選是否包含子資料夾、依副檔名類型篩選，整批加入索引；已收錄過的檔案會自動略過。"
         f"掃描途中超過 {SCAN_SOFT_LIMIT:,} 筆會先詢問要不要繼續（最多掃到 {SCAN_HARD_LIMIT:,} 筆），"
         f"這種情況下這次掃描結果不能直接匯入。"),
        (BTN_INDIGO_BG, "編輯索引檔案",
         "用系統預設程式開啟目前索引集的 .md 檔案，直接手動編輯格式或內容。"),
        (BTN_CYAN_BG, "重新載入索引",
         "索引 .md 檔案在外部被手動改過時，重新讀取內容，不用重開程式。"),
        (BTN_WARN_BG, "⚠️ 清除失效項目",
         "掃描目前索引，把指向的檔案已經不存在的資料列整批移除。"),
        (BTN_DANGER_BG, "🗑️ 批次刪除...",
         "開啟顯示原始流水號與項目名稱的清單，可用序號或名稱搜尋、勾選目前結果並批次移除；只刪索引紀錄，不刪硬碟檔案。"),
    ]),
    ("🧭 進階工具（以下都是跨全部索引集）", [
        (BTN_CYAN_BG, "🔄 更新內容快取",
         "重新擷取可讀取的文件內文，供全文搜尋使用；內容雜湊也會一併更新。"),
        (BTN_PRIMARY_BG, "🔎 找出未收錄檔案...",
         f"掃描「常用資料夾清單」（可管理／臨時新增），列出還沒被任何索引集收錄的檔案，勾選後整批加入指定索引集。"
         f"掃描途中超過 {SCAN_SOFT_LIMIT:,} 筆會先詢問要不要繼續（最多掃到 {SCAN_HARD_LIMIT:,} 筆），"
         f"這種情況下這次掃描結果不能直接加入索引；目標索引、分類與收錄按鈕固定在視窗底部。"),
        (BTN_ORANGE_BG, "🧬 重複偵測...",
         "按下後會自動重新驗證全部檔案的 SHA-256，再跨索引分組；每組選一筆保留後，只移除其餘索引列，不會刪除實體檔案。"),
        (BTN_PURPLE_BG, "✍️ 批次補說明...",
         "在背景擷取缺少說明的檔案內容並顯示進度；審核視窗每頁 8 筆，可編輯、調整 14–28pt 字級後批次套用。"),
    ]),
    ("📄 選取項目操作（先在下面清單點選一列）", [
        (BTN_PRIMARY_BG, "📂 開啟檔案",
         "用系統預設程式開啟目前選取的檔案（雙擊清單項目或按 Enter 效果一樣）。"),
        (BTN_SECONDARY_BG, "🗂️ 顯示於檔案總管",
         "打開檔案總管視窗並跳到、選取這個檔案。"),
        (BTN_PINK_BG, "📋 複製路徑",
         "把完整路徑複製到剪貼簿。"),
        (BTN_INDIGO_BG, "✏️ 編輯所選列",
         "修改這一筆資料的分類／說明文字。"),
        (BTN_BLUE_BG, "⤒ 第一筆／⤓ 最後一筆",
         "直接選取並捲動到目前結果的第一筆或最後一筆；Home／End、Ctrl+Home／Ctrl+End 也可操作。"),
        (BTN_DANGER_BG, "Delete 刪除所選列",
         "選取列會以藍色標記；按 Delete 後需再次確認，只移除索引紀錄，不刪除硬碟上的實體檔案。"),
    ]),
    ("💡 其他小技巧", [
        (None, "拖曳檔案", "與「新增檔案...」共用相同驗證與逐筆輸入流程；拖入資料夾會提示改用「匯入資料夾...」。"),
        (None, "加入時間", "新增、拖曳、資料夾匯入或未收錄收錄都會記錄時間（如 8/18 08:00）；既有舊項目顯示「—」。"),
        (None, "影音快捷鍵", "選取 MP3／MP4 後按空白鍵播放／暫停；影片大視窗最高 1280×720，左右鍵倒退／快轉 5 秒，Esc 關閉。"),
        (None, "預覽區塊", "依副檔名類型自動顯示圖片縮圖／文字內容／音樂影片播放；文字預覽可用 Ctrl+滾輪縮放字級，Ctrl+0 還原預設大小。"),
        (None, "清單捲動與預覽拉桿", "清單具垂直／水平捲動條；清單與預覽間的 ↔ 拉桿可左右拖曳調整預覽寬度。"),
        (None, "快捷鍵", "Ctrl+F 跳到搜尋框；Esc 清空目前搜尋文字。"),
    ]),
]


class HelpBar:
    def __init__(self, parent):
        self._expanded = False
        self._color_tags = set()  # 已經建立過的顏色 tag 名稱，避免重複 tag_configure

        font_toggle = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")
        font_summary = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")
        font_section = tkfont.Font(family=FONT_FAMILY, size=13, weight="bold")
        font_item = tkfont.Font(family=FONT_FAMILY, size=11, weight="bold")
        font_desc = tkfont.Font(family=FONT_FAMILY, size=11)
        self._font_item = font_item

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

        self._panel = tk.Frame(
            parent, bg=COLOR_PREVIEW_BG, highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
        )
        inner = tk.Frame(self._panel, bg=COLOR_PREVIEW_BG)
        inner.pack(fill="both", expand=True, padx=6, pady=6)
        text = tk.Text(
            inner, wrap="word", relief="flat", bd=0, highlightthickness=0, bg=COLOR_PREVIEW_BG,
            font=font_desc, cursor="arrow", height=17, padx=6, pady=4,
        )
        vsb = ttk.Scrollbar(inner, orient="vertical", command=text.yview)
        text.configure(yscrollcommand=vsb.set)
        text.pack(side="left", fill="both", expand=True)
        vsb.pack(side="right", fill="y")
        self._text = text
        self._populate_text(font_summary, font_section, font_desc)
        text.configure(state="disabled")

    def _set_collapsed_text(self):
        arrow = "▾" if self._expanded else "▸"
        hint = "再按一次收合" if self._expanded else "點這裡展開"
        self._toggle_var.set(f"{arrow}  ❓ 功能介紹／使用說明（{hint}）")

    def toggle(self):
        self._expanded = not self._expanded
        self._set_collapsed_text()
        if self._expanded:
            self._panel.pack(fill="x", padx=16, pady=(0, 8), after=self._bar)
        else:
            self._panel.pack_forget()

    def _item_tag(self, color):
        """依顏色取得（必要時建立）對應的 Text tag 名稱——直接沿用按鈕的底色常數，
        說明列的色塊才能跟畫面上真正的按鈕對得起來，一眼看出這行在講哪顆按鈕。"""
        color = color or BTN_SECONDARY_BG
        name = f"c_{color.lstrip('#')}"
        if name not in self._color_tags:
            self._text.tag_configure(
                name, font=self._font_item, foreground=color, spacing1=6, lmargin1=10, lmargin2=32,
            )
            self._color_tags.add(name)
        return name

    def _populate_text(self, font_summary, font_section, font_desc):
        t = self._text
        t.tag_configure(
            "summary", font=font_summary, foreground=COLOR_HEADER_BG,
            lmargin1=4, lmargin2=4, spacing3=14,
        )
        t.tag_configure(
            "section", font=font_section, foreground=COLOR_HEADER_BG,
            spacing1=14, spacing3=6,
        )
        t.tag_configure(
            "desc", font=font_desc, foreground=COLOR_STATUS_FG,
            lmargin1=32, lmargin2=32, spacing3=10,
        )

        t.insert("end", _HELP_SUMMARY + "\n", "summary")
        for title, items in _HELP_SECTIONS:
            t.insert("end", f"{title}\n", "section")
            for color, label, desc in items:
                bullet = "●" if color else "○"
                t.insert("end", f"{bullet}  {label}\n", self._item_tag(color))
                t.insert("end", f"{desc}\n", "desc")
