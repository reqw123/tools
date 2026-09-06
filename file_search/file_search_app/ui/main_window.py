"""主視窗——組裝畫面、綁定事件、管理目前選取狀態、呼叫 Service、顯示執行
結果、開啟 Dialog。不直接解析或寫入 Markdown、不計算 SHA-256、不掃描資料夾、
不擷取文件文字、不管理 VLC 細節——這些都透過建構子注入的 Service／
MediaController／platform.file_actions 完成。"""

import queue
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, font as tkfont, messagebox, ttk

try:
    from tkinterdnd2 import TkinterDnD
    _HAS_DND = True
except ImportError:
    _HAS_DND = False

from file_search_app.config import (
    ALL_INDEXES_LABEL, BTN_CREATE_ACTIVE, BTN_CREATE_BG, BTN_REFRESH_ACTIVE, BTN_REFRESH_BG,
    BTN_DANGER_ACTIVE, BTN_DANGER_BG, BTN_EDIT_ACTIVE, BTN_EDIT_BG,
    BTN_DETECT_ACTIVE, BTN_DETECT_BG, BTN_COPY_ACTIVE, BTN_COPY_BG,
    BTN_PRIMARY_ACTIVE, BTN_PRIMARY_BG, BTN_AI_ACTIVE, BTN_AI_BG,
    BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, BTN_IMPORT_ACTIVE, BTN_IMPORT_BG,
    BTN_WARN_ACTIVE, BTN_WARN_BG, COLOR_BG, COLOR_HEADER_BG, COLOR_HEADER_FG,
    COLOR_HEADER_SUB_FG, COLOR_MISSING_FG, COLOR_STATUS_FG, FONT_FAMILY, IMAGE_EXTS,
    INDEXES_DIR, MEDIA_EXTS, MEDIA_SEEK_SECONDS_MAX, MEDIA_SEEK_SECONDS_MIN,
    PREVIEW_DEFAULT_WIDTH, PREVIEW_GRIP_WIDTH, PREVIEW_MIN_WIDTH,
    STICKY_GRIP_WIDTH, STICKY_PANEL_DEFAULT_WIDTH, STICKY_PANEL_MIN_WIDTH,
    STICKY_REVEAL_HANDLE_WIDTH, TREE_MIN_WIDTH,
)
from file_search_app.media.media_controller import MediaController
from file_search_app.platform import file_actions
from file_search_app.services.import_service import path_key
from file_search_app.repositories.cache_repository import CACHE_TEXT_CHARS
from file_search_app.ui.async_task import poll_queue, start_worker
from file_search_app.ui.dialogs.delete_dialogs import BulkDeleteDialog
from file_search_app.ui.dialogs.ai_analyze_dialog import AIAnalyzeResultDialog
from file_search_app.ui.dialogs.ai_confirm_dialog import ask_ai_confirm
from file_search_app.ui.dialogs.ai_description_dialog import AISelectDialog
from file_search_app.ui.dialogs.ai_settings_dialog import AISettingsDialog
from file_search_app.ui.dialogs.description_dialog import BatchDescribeDialog
from file_search_app.ui.dialogs.duplicate_dialog import DuplicateDialog
from file_search_app.ui.dialogs.import_dialogs import ImportFolderDialog
from file_search_app.ui.dialogs.index_dialogs import AddEntryDialog, CreateIndexDialog
from file_search_app.ui.dialogs.scan_dialogs import KnownFoldersDialog, UnindexedScanDialog
from file_search_app.ui.styles import styled_button
from file_search_app.ui.widgets.help_bar import HelpBar
from file_search_app.ui.widgets.index_tree import IndexTree
from file_search_app.ui.widgets.preview_panel import PreviewPanel
from file_search_app.ui.widgets.sticky_note_panel import StickyNotePanel

_BaseTk = TkinterDnD.Tk if _HAS_DND else tk.Tk

# 「AI 設定點這裡」引導泡泡的配色：淡橙＋橙框，帶「先看這裡」的意味，跟工具
# 列上其他色塊區隔。AI 設定沒有獨立按鈕，是從「🤖 AI 批次說明...」進去的，
# 第一次用的人不會知道，所以在那顆按鈕旁常駐一個對話框泡泡（含指向按鈕的
# 小尾巴），外框會緩慢一明一暗地呼吸，餘光就能注意到、又不會刺眼。
_AI_HINT_BG = "#fff7ed"          # 泡泡底色（收縮相位）
_AI_HINT_BG_HI = "#fdba74"       # 泡泡底色（脹大相位，明顯偏橙）
_AI_HINT_BORDER = "#fb923c"      # 泡泡外框（收縮相位）
_AI_HINT_BORDER_HI = "#ea580c"   # 泡泡外框＋光暈（脹大相位）
_AI_HINT_FG = "#9a3412"
_AI_HINT_PERIOD_MS = 1700        # 半個呼吸週期（吸→吐 或 吐→吸）的時間
_AI_HINT_FPS_MS = 40             # 每幀間隔（約 25fps，動起來夠順）
_AI_HINT_GLOW_MAX = 9            # 光暈脹大時往外擴的像素


def _lerp_color(c1: str, c2: str, t: float) -> str:
    """在兩個 #rrggbb 之間線性內插，t=0 回 c1、t=1 回 c2。泡泡外框呼吸動畫用。"""
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    a = (int(c1[1:3], 16), int(c1[3:5], 16), int(c1[5:7], 16))
    b = (int(c2[1:3], 16), int(c2[3:5], 16), int(c2[5:7], 16))
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(a, b))


def _round_rect_points(x1, y1, x2, y2, r):
    """給 create_polygon(smooth=True) 用的圓角矩形頂點序列。"""
    return [
        x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r, x2, y2 - r, x2, y2,
        x2 - r, y2, x1 + r, y2, x1, y2, x1, y2 - r, x1, y1 + r, x1, y1,
    ]


class MainWindow(_BaseTk):
    def __init__(
        self, *, index_service, search_service, import_service, scan_service,
        duplicate_service, description_service, cache_service, preview_service,
        metadata_repo, ai_description_service, ai_settings_repo, transcription_service,
        sticky_note_service, app_prefs_repo,
        media_controller_cls=MediaController,
    ):
        super().__init__()
        self._index = index_service
        self._search = search_service
        self._import = import_service
        self._scan = scan_service
        self._duplicate = duplicate_service
        self._description = description_service
        self._cache = cache_service
        self._preview_service = preview_service
        self._metadata = metadata_repo
        self._ai_description = ai_description_service
        self._ai_settings_repo = ai_settings_repo
        self._transcription = transcription_service
        self._sticky_notes = sticky_note_service
        self._app_prefs = app_prefs_repo
        # 影片方向鍵一次跳轉的秒數，跨次啟動記住；播放列的「跳轉 N 秒」欄位會改它。
        self._seek_seconds = app_prefs_repo.load_seek_seconds()
        # MediaController 需要 Tk root 的 after/after_cancel 才能排程，這兩個原語
        # 只有 Tk 實例真正建構完成後才存在，所以晚一步在這裡才建立實例，而不是
        # 跟其他 Service 一樣由 app.py 事先組好傳進來。
        self._media = media_controller_cls(self.after, self.after_cancel)

        self.title("檔案快速搜尋")
        self.configure(bg=COLOR_BG)
        self.geometry("1300x760")
        self.minsize(900, 520)

        self._font_title = tkfont.Font(family=FONT_FAMILY, size=18, weight="bold")
        self._font_label = tkfont.Font(family=FONT_FAMILY, size=13)
        self._font_hint = tkfont.Font(family=FONT_FAMILY, size=11)
        self._font_search = tkfont.Font(family=FONT_FAMILY, size=16)
        self._font_total_count = tkfont.Font(family=FONT_FAMILY, size=20, weight="bold")
        self._font_warning = tkfont.Font(family=FONT_FAMILY, size=11, weight="bold")

        self._all_entries = []       # list[IndexEntry]，_reload_index() 填入
        self._filtered_entries = []  # 目前檢視範圍（分類／資料夾／搜尋文字套用後）：_apply_filter() 填入
        # 搜尋框打字用的去抖動計時器——每個按鍵都重跑 filter_entries（掃全部
        # entries）＋整個 Treeview 砍掉重建，索引一大就頓；停頓一下才真的重篩。
        self._filter_after_id = None
        self._entry_cache = {}       # path_str -> {mtime,size,hash,text}，牽涉到的索引集內容快取合併
        self._current_index_path = None  # None 且選單顯示「全部索引」＝聚合模式；None 且選單是空的＝沒有任何索引可用
        self._preview_width = PREVIEW_DEFAULT_WIDTH
        self._preview_drag_start_x = None
        self._preview_drag_start_width = None
        # 便利貼面板寬度不像分類/資料夾篩選那樣跨次啟動記住——每次啟動都回到
        # 預設寬度，只有「上次展開還是收合」這個開關狀態會存檔（見 _toggle_sticky_panel）。
        self._sticky_visible = self._sticky_notes.load_panel_visible()
        self._sticky_width = STICKY_PANEL_DEFAULT_WIDTH
        self._sticky_drag_start_x = None
        self._sticky_drag_start_width = None

        # 清單選取變化時，媒體播放器的重新建立會延遲一小段時間才真正執行——快速
        # 用方向鍵連續切換好幾個 mp3/mp4 時，避免每切一格就重建一次 libvlc
        # player／HWND，密集重建在部分 Windows 顯示卡組合下有機率引發原生層的
        # 資源競爭。
        self._media_load_after_id = None
        self._pending_media_path = None

        self._index.ensure_default_index()  # indexes/ 底下沒有任何 .md 就自動補一份格式正確的空白索引
        self._build_ui()
        self._refresh_index_list(select_first=True)
        self.bind_all("<Control-f>", self._focus_search)
        self.bind_all("<Escape>", self._clear_search)
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        # 預覽內容縮放：跟 VS Code 同一套鍵位，+/- 兩種鍵盤都各綁一份（有無 Shift
        # 皆可、小鍵盤也算），全域生效，不用先把滑鼠移到預覽區塊上。
        for seq in ("<Control-plus>", "<Control-equal>", "<Control-KP_Add>"):
            self.bind_all(seq, self._preview.zoom_in)
        for seq in ("<Control-minus>", "<Control-KP_Subtract>"):
            self.bind_all(seq, self._preview.zoom_out)
        for seq in ("<Control-0>", "<Control-KP_0>"):
            self.bind_all(seq, self._preview.zoom_reset)
        # 開關便利貼面板：跟 Shift 一起按時 Tk 送出的 keysym 是大寫，兩種都綁
        # 才不會因為鍵盤/系統差異漏接。
        for seq in ("<Control-Shift-N>", "<Control-Shift-n>"):
            self.bind_all(seq, self._toggle_sticky_panel)

    # ── 版面 ─────────────────────────────────────────────────────────

    def _build_ui(self):
        header = tk.Frame(self, bg=COLOR_HEADER_BG)
        header.pack(fill="x")
        tk.Label(
            header, text="📁 檔案快速搜尋", bg=COLOR_HEADER_BG, fg=COLOR_HEADER_FG,
            font=self._font_title, anchor="w",
        ).pack(side="left", padx=18, pady=14)

        index_picker = tk.Frame(header, bg=COLOR_HEADER_BG)
        index_picker.pack(side="right", padx=18)
        self._index_status_var = tk.StringVar(value="")
        tk.Label(
            index_picker, textvariable=self._index_status_var, bg=COLOR_HEADER_BG, fg=COLOR_HEADER_SUB_FG,
            font=self._font_hint, anchor="e",
        ).pack(side="bottom", anchor="e")
        tk.Label(
            index_picker, text="索引集：", bg=COLOR_HEADER_BG, fg=COLOR_HEADER_SUB_FG, font=self._font_hint,
        ).pack(side="left")
        self._index_var = tk.StringVar()
        self._index_combo = ttk.Combobox(
            index_picker, textvariable=self._index_var, state="readonly", font=self._font_hint, width=24,
        )
        self._index_combo.pack(side="left")
        self._index_combo.bind("<<ComboboxSelected>>", lambda _e: self._on_index_selected())
        styled_button(
            index_picker, "➕ 新增索引集...", self._on_create_index, BTN_CREATE_BG, BTN_CREATE_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(10, 0))
        styled_button(
            index_picker, "🗑️ 刪除索引集", self._on_delete_index,
            BTN_DANGER_BG, BTN_DANGER_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))

        HelpBar(self, self._app_prefs)

        toolbar = tk.Frame(self, bg=COLOR_BG)
        toolbar.pack(fill="x", padx=16, pady=(12, 6))
        tk.Label(toolbar, text="🔍", bg=COLOR_BG, font=self._font_search).pack(side="left", padx=(0, 6))
        self._search_var = tk.StringVar()
        self._search_entry = tk.Entry(toolbar, textvariable=self._search_var, font=self._font_search, relief="flat")
        self._search_entry.pack(side="left", fill="x", expand=True, ipady=6)
        self._search_var.trace_add("write", lambda *_a: self._schedule_apply_filter())

        combo_style = ttk.Style(self)
        combo_style.configure("Medium.TCombobox", font=self._font_label)
        # Combobox 本體與展開後的清單項目都使用中等字體。
        self.option_add("*TCombobox*Listbox.font", self._font_label)
        filter_box = tk.Frame(
            toolbar, bg="#dbeafe", highlightbackground="#93c5fd", highlightthickness=1,
        )
        filter_box.pack(side="left", padx=(12, 0), ipady=5)
        category_box = tk.Frame(filter_box, bg="#dbeafe")
        category_box.pack(side="left", padx=(10, 6))
        tk.Label(category_box, text="分類：", bg="#dbeafe", fg="#1e3a8a", font=self._font_label).pack(side="left", padx=(0, 4))
        self._category_var = tk.StringVar(value="全部")
        self._category_combo = ttk.Combobox(
            category_box, textvariable=self._category_var, state="readonly",
            font=self._font_label, style="Medium.TCombobox", width=12,
        )
        self._category_combo.pack(side="left")
        self._category_combo.bind("<<ComboboxSelected>>", lambda _e: self._apply_filter())

        folder_box = tk.Frame(filter_box, bg="#dbeafe")
        folder_box.pack(side="left", padx=(6, 10))
        folder_row = tk.Frame(folder_box, bg="#dbeafe")
        folder_row.pack(side="top", anchor="w")
        tk.Label(folder_row, text="資料夾：", bg="#dbeafe", fg="#1e3a8a", font=self._font_label).pack(side="left", padx=(0, 4))
        self._folder_var = tk.StringVar(value="全部")
        self._folder_combo = ttk.Combobox(
            folder_row, textvariable=self._folder_var, state="readonly",
            font=self._font_label, style="Medium.TCombobox", width=18,
        )
        self._folder_combo.pack(side="left")
        self._folder_combo.bind("<<ComboboxSelected>>", lambda _e: self._apply_filter())
        # 「選檔案問 AI」：跟索引無關的即席分析——自選任何檔案送目前設定的
        # Provider，只把回覆顯示出來供查看，不寫回索引。放在資料夾篩選正下方。
        styled_button(
            folder_box, "🔬 選檔案問 AI...", self._on_ask_ai_about_file,
            BTN_AI_BG, BTN_AI_ACTIVE, self._font_hint,
        ).pack(side="top", anchor="w", pady=(5, 0))

        toolbar2 = tk.Frame(self, bg=COLOR_BG)
        toolbar2.pack(fill="x", padx=16, pady=(0, 6))
        styled_button(
            toolbar2, "新增檔案...", self._on_add_file_dialog, BTN_CREATE_BG, BTN_CREATE_ACTIVE, self._font_hint,
        ).pack(side="left")
        styled_button(
            toolbar2, "匯入資料夾...", self._on_import_folder, BTN_IMPORT_BG, BTN_IMPORT_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            toolbar2, "編輯索引檔案", self._open_index_file, BTN_AI_BG, BTN_AI_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            toolbar2, "重新載入索引", self._reload_index, BTN_REFRESH_BG, BTN_REFRESH_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            toolbar2, "⚠️ 清除失效項目", self._cleanup_missing, BTN_WARN_BG, BTN_WARN_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            toolbar2, "🗑️ 批次刪除...", self._on_bulk_delete, BTN_DANGER_BG, BTN_DANGER_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))
        hint = "（可把檔案拖曳進下面清單直接新增）" if _HAS_DND else "（拖曳新增功能未啟用：缺少 tkinterdnd2 套件，仍可用「新增檔案...」按鈕）"
        tk.Label(toolbar2, text=hint, bg=COLOR_BG, fg=COLOR_STATUS_FG, font=self._font_hint).pack(side="left", padx=(10, 0))

        toolbar3 = tk.Frame(self, bg=COLOR_BG)
        toolbar3.pack(fill="x", padx=16, pady=(0, 6))
        styled_button(
            toolbar3, "🔄 更新內容快取", self._on_update_cache, BTN_REFRESH_BG, BTN_REFRESH_ACTIVE, self._font_hint,
        ).pack(side="left")
        styled_button(
            toolbar3, "🔎 找出未收錄檔案...", self._on_find_unindexed, BTN_PRIMARY_BG, BTN_PRIMARY_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            toolbar3, "🧬 重複偵測...", self._on_find_duplicates, BTN_DETECT_BG, BTN_DETECT_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            toolbar3, "✍️ 批次補說明...", self._on_batch_describe, BTN_AI_BG, BTN_AI_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            toolbar3, "🤖 AI 批次說明...", self._on_ai_batch_describe, BTN_AI_BG, BTN_AI_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))

        # 「AI 設定」沒有自己的按鈕——要先開「🤖 AI 批次說明...」，視窗裡才有
        # 「⚙️ AI 設定...」。第一次用的人找不到，所以在這顆按鈕右邊常駐一個
        # 對話框泡泡（左邊小尾巴指著按鈕），外框緩慢呼吸提醒。
        self._build_ai_settings_hint(toolbar3).pack(side="left", padx=(2, 0))

        # 警告提示不再跟四顆工具按鈕硬塞在同一橫列；獨立成下一列並依可用寬度
        # 自動換行，避免視窗較窄、Windows 顯示縮放較大時右半段被裁掉。
        toolbar3_notice = tk.Frame(self, bg=COLOR_BG)
        toolbar3_notice.pack(fill="x", padx=16, pady=(0, 6))
        toolbar3_notice_label = tk.Label(
            toolbar3_notice,
            text="⚠️ 跨全部索引集：全文搜尋前要更新內容快取；重複偵測會自動重新驗證 SHA-256。",
            bg=COLOR_BG, fg=COLOR_MISSING_FG, font=self._font_warning,
            anchor="w", justify="left",
        )
        toolbar3_notice_label.pack(fill="x")
        toolbar3_notice.bind(
            "<Configure>",
            lambda e: toolbar3_notice_label.configure(wraplength=max(120, e.width - 8)),
        )

        body = tk.Frame(self, bg=COLOR_BG)
        body.pack(fill="both", expand=True, padx=16, pady=(0, 6))
        self._body_frame = body

        self._sticky_panel = StickyNotePanel(
            body, self._sticky_notes, self._ai_description, self._on_open_ai_settings,
            self._font_hint, self._sticky_width,
            on_collapse=self._toggle_sticky_panel,
        )
        self._sticky_grip = tk.Frame(body, bg="#c7d3dc", width=STICKY_GRIP_WIDTH, cursor="sb_h_double_arrow")
        sticky_grip_label = tk.Label(
            self._sticky_grip, text="↔", bg="#c7d3dc", fg=COLOR_STATUS_FG,
            font=tkfont.Font(family=FONT_FAMILY, size=10), cursor="sb_h_double_arrow",
        )
        sticky_grip_label.place(relx=0.5, rely=0.5, anchor="center")
        for w in (self._sticky_grip, sticky_grip_label):
            w.bind("<ButtonPress-1>", self._on_sticky_grip_press)
            w.bind("<B1-Motion>", self._on_sticky_grip_drag)
            w.bind("<Enter>", lambda _e: self._sticky_grip.configure(bg="#5d7285"))
            w.bind("<Leave>", lambda _e: self._sticky_grip.configure(bg="#c7d3dc"))

        # 面板收合時在最左邊界留下的細長「▶」把手——點一下重新展開便利貼面板。
        # 只在收合狀態 pack（見 _set_sticky_pack_state），展開時整條收起來不佔寬。
        self._sticky_reveal = tk.Frame(
            body, bg="#c7d3dc", width=STICKY_REVEAL_HANDLE_WIDTH, cursor="hand2",
        )
        sticky_reveal_label = tk.Label(
            self._sticky_reveal, text="▶", bg="#c7d3dc", fg=COLOR_STATUS_FG,
            font=tkfont.Font(family=FONT_FAMILY, size=10), cursor="hand2",
        )
        sticky_reveal_label.place(relx=0.5, rely=0.5, anchor="center")
        for w in (self._sticky_reveal, sticky_reveal_label):
            w.bind("<Button-1>", self._toggle_sticky_panel)
            w.bind("<Enter>", lambda _e: self._sticky_reveal.configure(bg="#5d7285"))
            w.bind("<Leave>", lambda _e: self._sticky_reveal.configure(bg="#c7d3dc"))

        self._tree = IndexTree(
            body, self._font_label,
            on_select=self._update_preview, on_activate=self._open_selected,
            on_delete_key=self._on_delete_selected, on_space=self._on_selected_media_space,
            on_seek=self._on_media_arrow,
        )
        self._tree.frame.pack(side="left", fill="both", expand=True)

        # 橫向拉桿：夾在清單跟預覽區塊中間，拖曳可以調整預覽區塊寬度（清單用
        # expand=True，寬度會自動讓出來，不用另外算清單該縮多少）。↔ 圖示 + 滑鼠
        # 移上去變左右箭頭游標，提示這裡可以橫向拖曳。
        grip = tk.Frame(body, bg="#c7d3dc", width=PREVIEW_GRIP_WIDTH, cursor="sb_h_double_arrow")
        grip.pack(side="left", fill="y", padx=(10, 0))
        grip.pack_propagate(False)
        grip_label = tk.Label(
            grip, text="↔", bg="#c7d3dc", fg=COLOR_STATUS_FG,
            font=tkfont.Font(family=FONT_FAMILY, size=10), cursor="sb_h_double_arrow",
        )
        grip_label.place(relx=0.5, rely=0.5, anchor="center")
        for w in (grip, grip_label):
            w.bind("<ButtonPress-1>", self._on_preview_grip_press)
            w.bind("<B1-Motion>", self._on_preview_grip_drag)
            w.bind("<Enter>", lambda _e: grip.configure(bg="#5d7285"))
            w.bind("<Leave>", lambda _e: grip.configure(bg="#c7d3dc"))

        self._preview = PreviewPanel(
            body, self._preview_service, self._media, self._font_label, self._font_hint,
            self._preview_width,
            on_media_entry=self._schedule_load_media,
            on_space_shortcut=self._on_selected_media_space,
            on_seek_shortcut=self._on_media_arrow,
            get_seek_seconds=lambda: self._seek_seconds,
            on_seek_seconds_change=self._on_seek_seconds_change,
            transcription_available=self._transcription.available,
            get_cached_text=self._get_cached_text_for,
            on_transcribe_request=self._on_transcribe_request,
        )
        self._preview.frame.pack(side="left", fill="y")

        # 便利貼面板／拉桿要放在 IndexTree 前面（最左邊）；tree/preview 建好
        # 之後才能用 before=self._tree.frame 精確插入這個位置，不管之後展開/
        # 收合幾次都能維持在最左邊，不會被 pack 的呼叫順序影響跑到最右邊去。
        self._set_sticky_pack_state()

        # 視窗本身被拉大/縮小時，清單／預覽兩塊的寬度也要跟著重新分配（不然
        # 窗口變寬時多出來的空間會沒人要，變窄時兩塊又可能疊在一起）。
        body.bind("<Configure>", lambda _e: self._sync_body_layout())
        self.after_idle(self._sync_body_layout)

        if _HAS_DND:
            self._tree.enable_drop(self._on_drop_files)

        action_bar = tk.Frame(self, bg=COLOR_BG)
        action_bar.pack(fill="x", padx=16, pady=(0, 6))
        styled_button(
            action_bar, "📂 開啟檔案", self._open_selected, BTN_PRIMARY_BG, BTN_PRIMARY_ACTIVE, self._font_label,
        ).pack(side="left")
        styled_button(
            action_bar, "🗂️ 顯示於檔案總管", self._reveal_selected, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, self._font_label,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            action_bar, "📋 複製路徑", self._copy_selected_path, BTN_COPY_BG, BTN_COPY_ACTIVE, self._font_label,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            action_bar, "✏️ 編輯所選列", self._on_edit_selected, BTN_EDIT_BG, BTN_EDIT_ACTIVE, self._font_label,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            action_bar, "⤒ 第一筆", lambda: self._tree.jump_to_edge(False),
            BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            action_bar, "⤓ 最後一筆", lambda: self._tree.jump_to_edge(True),
            BTN_CREATE_BG, BTN_CREATE_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))

        status_bar = tk.Frame(self, bg=COLOR_BG)
        status_bar.pack(fill="x", padx=16, pady=(0, 12))
        tk.Label(
            status_bar, text="索引項目總數：", bg=COLOR_BG, fg=COLOR_HEADER_BG,
            font=self._font_label, anchor="w",
        ).pack(side="left")
        self._total_count_var = tk.StringVar(value="0")
        tk.Label(
            status_bar, textvariable=self._total_count_var, bg="#fff7ed", fg="#c2410c",
            font=self._font_total_count, padx=10, pady=2, relief="solid", bd=1,
        ).pack(side="left", padx=(2, 14))
        self._status_var = tk.StringVar(value="")
        tk.Label(
            status_bar, textvariable=self._status_var, bg=COLOR_BG, fg=COLOR_STATUS_FG,
            font=self._font_hint, anchor="w",
        ).pack(side="left", fill="x", expand=True)

    # ── 多份索引檔案 ─────────────────────────────────────────────────

    def _on_create_index(self):
        CreateIndexDialog(self, self._index.validate_name, self._create_index_confirmed)

    def _create_index_confirmed(self, filename):
        self._index.create_index(filename)
        # 先把下拉選單的值設成新檔名，_refresh_index_list() 看到目前選取的值已經
        # 在候選清單裡（因為檔案剛建好），就不會被 select_first 邏輯改選別的，
        # 直接切換過去新建立的這份空白索引集。
        self._index_var.set(filename)
        self._refresh_index_list()

    def _on_delete_index(self):
        """刪除目前單一索引集及其附屬資料，但絕不碰索引指向的實體檔案。"""
        if self._current_index_path is None:
            messagebox.showwarning("刪除索引集", "請先在右上角選擇一份指定的索引集；「全部索引」模式不能刪除。")
            return

        index_path = self._current_index_path
        entry_count = self._index.entry_count(index_path)
        confirmed = messagebox.askyesno(
            "確認刪除索引集",
            f"確定要刪除索引集「{index_path.name}」嗎？\n\n"
            f"索引項目：{entry_count} 筆\n"
            "只會刪除索引紀錄，不會刪除硬碟上的實體檔案。\n\n"
            "此動作無法復原。",
            icon="warning",
        )
        if not confirmed:
            return

        try:
            self._index.delete_index(index_path)
        except OSError as exc:
            messagebox.showerror("刪除索引集", f"無法刪除「{index_path.name}」：\n{exc}")
            return

        self._index_var.set("")
        self._current_index_path = None
        self._index.ensure_default_index()
        self._refresh_index_list(select_first=True)
        messagebox.showinfo("刪除索引集", f"已刪除「{index_path.name}」。\n實體檔案沒有被刪除。")

    def _refresh_index_list(self, select_first=False):
        files = self._index.list_index_files()
        names = [p.name for p in files]
        values = ([ALL_INDEXES_LABEL] + names) if files else []
        self._index_combo["values"] = values
        if not files:
            self._index_var.set("")
            self._current_index_path = None
            self._all_entries = []
            self._entry_cache = {}
            self._index_status_var.set(f"📑 {INDEXES_DIR.name}/ 底下沒有任何 .md 索引檔案")
            self._apply_filter()
            return
        if select_first or self._index_var.get() not in values:
            self._index_var.set(names[0])
        self._on_index_selected()

    def _on_index_selected(self):
        choice = self._index_var.get()
        self._current_index_path = None if choice == ALL_INDEXES_LABEL else (INDEXES_DIR / choice)
        self._reload_index()

    # ── 索引載入／搜尋 ───────────────────────────────────────────────

    def _reload_index(self):
        if self._current_index_path is None and self._index_var.get() != ALL_INDEXES_LABEL:
            return  # 目前沒有任何索引檔案可用（_refresh_index_list 已經處理過狀態列文字）
        entries, cache, status = self._index.load_all_entries(self._current_index_path)
        self._all_entries = entries
        self._entry_cache = cache
        self._index_status_var.set(status)

        category_values = self._search.build_category_options(entries)
        self._category_combo["values"] = category_values
        if self._category_var.get() not in category_values:
            self._category_var.set("全部")

        folder_values = self._search.build_folder_options(entries)
        self._folder_combo["values"] = folder_values
        if self._folder_var.get() not in folder_values:
            self._folder_var.set("全部")

        self._apply_filter()

    def _schedule_apply_filter(self):
        """只給搜尋框打字用——分類／資料夾下拉、重新載入那些要即時反映的
        觸發點仍然直接呼叫 _apply_filter()。"""
        if self._filter_after_id is not None:
            self.after_cancel(self._filter_after_id)
        self._filter_after_id = self.after(180, self._apply_filter)

    def _apply_filter(self):
        if self._filter_after_id is not None:
            self.after_cancel(self._filter_after_id)
            self._filter_after_id = None
        typed = self._search_var.get().strip()
        wanted_category = self._category_var.get()
        wanted_folder = self._folder_var.get()
        filtered = self._search.filter_entries(self._all_entries, typed, wanted_category, wanted_folder, self._entry_cache)
        self._filtered_entries = filtered
        self._tree.set_entries(filtered, aggregate_mode=(self._current_index_path is None))

        total = len(self._all_entries)
        shown = len(filtered)
        self._total_count_var.set(str(total))
        notes = []
        if wanted_category != "全部":
            notes.append(f"分類「{wanted_category}」")
        if wanted_folder != "全部":
            notes.append("指定資料夾")
        note = "，" + "、".join(notes) if notes else ""
        if typed:
            self._status_var.set(f"🔍 符合「{typed}」{note}：{shown} / {total} 筆")
        else:
            self._status_var.set(f"共 {total} 筆索引{note}（⚠️ 紅字表示該路徑目前找不到檔案，可能已搬移或刪除）")
        self._update_preview()

    # ── 預覽 ─────────────────────────────────────────────────────────

    def _update_preview(self):
        self._preview.show_entry(self._tree.selected_entry())

    def _on_preview_grip_press(self, event):
        self._preview_drag_start_x = event.x_root
        self._preview_drag_start_width = self._preview.frame.winfo_width()

    def _on_preview_grip_drag(self, event):
        if self._preview_drag_start_width is None:
            return
        # 拖桿往左移（滑鼠 x 變小）＝把清單的寬度讓給預覽區塊，所以是減號。
        delta = event.x_root - self._preview_drag_start_x
        self._preview_width = self._preview_drag_start_width - delta
        self._sync_body_layout()

    # ── 便利貼面板（常駐最左側，可收合） ─────────────────────────────

    def _set_sticky_pack_state(self):
        if self._sticky_visible:
            self._sticky_reveal.pack_forget()
            self._sticky_panel.frame.pack(side="left", fill="y", before=self._tree.frame)
            self._sticky_grip.pack(side="left", fill="y", padx=(10, 0), before=self._tree.frame)
            self._sticky_grip.pack_propagate(False)
        else:
            self._sticky_panel.frame.pack_forget()
            self._sticky_grip.pack_forget()
            self._sticky_reveal.pack(side="left", fill="y", before=self._tree.frame)
            self._sticky_reveal.pack_propagate(False)

    def _toggle_sticky_panel(self, event=None):
        self._sticky_visible = not self._sticky_visible
        self._sticky_notes.save_panel_visible(self._sticky_visible)
        self._set_sticky_pack_state()
        self._sync_body_layout()

    def _on_sticky_grip_press(self, event):
        self._sticky_drag_start_x = event.x_root
        self._sticky_drag_start_width = self._sticky_panel.frame.winfo_width()

    def _on_sticky_grip_drag(self, event):
        if self._sticky_drag_start_width is None:
            return
        # 拖桿往右移（滑鼠 x 變大）＝把清單的寬度讓給便利貼面板，所以是加號
        # （跟預覽區塊那支拉桿方向相反，因為便利貼面板在清單的左邊而不是右邊）。
        delta = event.x_root - self._sticky_drag_start_x
        self._sticky_width = self._sticky_drag_start_width + delta
        self._sync_body_layout()

    def _sync_body_layout(self):
        """統一依「目前視窗實際寬度」重新分配便利貼／拉桿／清單／拉桿／預覽
        區塊的寬度：預覽區塊夾在 [PREVIEW_MIN_WIDTH, 視窗寬度扣掉其餘區塊至少
        要留的寬度] 之間，便利貼面板（展開時）夾在 [STICKY_PANEL_MIN_WIDTH,
        扣掉預覽跟清單至少寬度後剩下的空間] 之間，清單永遠拿走最後剩下的全部
        空間——上限都用即時量到的視窗寬度算，整個視窗被拉大/縮小時會自動
        重新分配，不會有一塊被擠到看不見或超出視窗。便利貼面板收合時完全不
        佔用寬度，等同兩塊面板版面。"""
        self._body_frame.update_idletasks()
        body_w = self._body_frame.winfo_width()
        if body_w <= 1:
            return  # 視窗還沒真正繪製出來，量到的寬度沒有意義，先跳過
        sticky_reserved = (
            (self._sticky_width + STICKY_GRIP_WIDTH + 10)
            if self._sticky_visible else STICKY_REVEAL_HANDLE_WIDTH
        )

        max_preview = max(PREVIEW_MIN_WIDTH, body_w - sticky_reserved - PREVIEW_GRIP_WIDTH - 10 - TREE_MIN_WIDTH)
        preview_w = int(max(PREVIEW_MIN_WIDTH, min(self._preview_width, max_preview)))
        self._preview_width = preview_w
        self._preview.resize(preview_w)

        if self._sticky_visible:
            max_sticky = max(
                STICKY_PANEL_MIN_WIDTH,
                body_w - PREVIEW_GRIP_WIDTH - 10 - preview_w - STICKY_GRIP_WIDTH - 10 - TREE_MIN_WIDTH,
            )
            sticky_w = int(max(STICKY_PANEL_MIN_WIDTH, min(self._sticky_width, max_sticky)))
            self._sticky_width = sticky_w
            self._sticky_panel.resize(sticky_w)
            sticky_reserved = sticky_w + STICKY_GRIP_WIDTH + 10

        tree_w = body_w - sticky_reserved - PREVIEW_GRIP_WIDTH - 10 - preview_w
        self._tree.configure_width(max(TREE_MIN_WIDTH, tree_w))

    # ── mp3/mp4 播放（防彈跳排程與選取狀態相關的部分留在這裡） ─────────

    def _cancel_media_load_schedule(self):
        if self._media_load_after_id is not None:
            try:
                self.after_cancel(self._media_load_after_id)
            except Exception:
                pass
            self._media_load_after_id = None

    def _schedule_load_media(self, p: Path):
        """跟直接載入的差別：不立刻重建播放器，先記下「使用者現在選的是這個
        檔案」，等選取穩定一小段時間才真的觸發。用方向鍵快速連續切換清單裡
        好幾個 mp3/mp4 時，選取變化會密集觸發，若每次都立刻重建原生播放器／
        HWND，在部分 Windows 顯示卡組合下有微小機率引發資源競爭；防彈跳讓
        只有「最後選定、沒有再被新選取取消掉」的那一次才會真的建立播放器。"""
        self._pending_media_path = p
        self._cancel_media_load_schedule()
        self._media_load_after_id = self.after(150, self._commit_scheduled_media_load)

    def _commit_scheduled_media_load(self):
        self._media_load_after_id = None
        p = self._pending_media_path
        if p is None:
            return
        # 排程等待期間使用者可能已經切到別的清單列（甚至切到非媒體項目），
        # 只有目前選取仍然是排程當下那個路徑才真的載入，避免載入一個使用者
        # 已經看不到的檔案。
        entry = self._tree.selected_entry()
        if entry is None or entry.path != str(p):
            return
        self._preview.media_panel.load_media(p)

    def _on_selected_media_space(self, _event=None):
        """清單有選取 mp3/mp4 等媒體時，空白鍵直接播放／暫停。這是使用者明確要
        求「現在就播放」的動作，不走防彈跳延遲——先取消任何還沒觸發的排程
        載入，避免等一下又觸發一次重複載入同一個檔案。"""
        entry = self._tree.selected_entry()
        path = entry.path if entry else None
        if not path or Path(path).suffix.lower() not in MEDIA_EXTS:
            return None
        if not Path(path).exists() or not self._media.available:
            return "break"
        if self._media.current_path != str(Path(path)):
            self._cancel_media_load_schedule()
            self._preview.activate_media(Path(path))
        self._preview.media_panel.play_pause()
        return "break"

    def _on_media_arrow(self, _event, direction):
        """影片播放時左右鍵倒退／快轉；`direction` 是 -1（左）或 +1（右），實際
        秒數由使用者可調的 self._seek_seconds 決定。沒有載入影片就回傳 None，
        讓左右鍵保留原本的 Treeview 導覽行為。"""
        if not self._media.current_path or not self._media.is_video:
            return None
        self._media.seek_by(direction * self._seek_seconds * 1000)
        return "break"

    def _on_seek_seconds_change(self, seconds):
        """播放列「跳轉 N 秒」欄位變動時：夾進合法範圍、更新目前值並存檔。
        回傳夾過的值，讓 UI 欄位可以校正使用者輸入的超範圍數字。"""
        seconds = max(MEDIA_SEEK_SECONDS_MIN, min(MEDIA_SEEK_SECONDS_MAX, int(seconds)))
        if seconds != self._seek_seconds:
            self._seek_seconds = seconds
            self._app_prefs.save_seek_seconds(seconds)
        return seconds

    # ── 音訊／影片轉錄 ───────────────────────────────────────────────

    def _get_cached_text_for(self, path_str):
        """PreviewPanel 判斷某個路徑目前有沒有轉錄文字（決定要不要顯示「查看
        轉錄文字」按鈕）用；不存在或還沒有文字都回傳 None，不用另外判斷
        dict 有沒有這個 key。"""
        return self._entry_cache.get(path_str, {}).get("text") or None

    def _on_transcribe_request(self, entry, on_progress, on_done, cancel_event):
        """PreviewPanel 按下「🎙️／🔁 轉錄」時呼叫：在背景執行緒跑本地語音辨識
        （模型載入與解碼都可能要一段時間），主執行緒只負責輪詢 Queue 更新畫面，
        不會被卡住；cancel_event 由 PreviewPanel 建立並傳入，使用者按下
        「取消」時會被設置，背景執行緒每處理完一個語音片段就會檢查一次。

        轉錄成功會直接寫入內容快取（覆蓋掉這一筆原有的文字，不彈窗確認——
        使用者是明確按下按鈕才會觸發這個動作），同步更新 self._entry_cache
        讓全文搜尋跟「查看轉錄文字」立刻看到最新內容，不需要整個重新載入
        索引。"""
        result_queue = queue.Queue()

        def _worker():
            try:
                text, error, cancelled = self._transcription.transcribe(
                    Path(entry.path),
                    progress_cb=lambda fraction: result_queue.put(("progress", fraction)),
                    cancel_check=cancel_event.is_set,
                )
            except Exception as exc:  # noqa: BLE001
                # transcribe() 正常都回傳三元組、不拋例外，但真的出了未預期
                # 的錯也要送回佇列——否則 _poll 無限空轉，而且 PreviewPanel
                # 的 _transcribing 會永遠卡在 True，轉錄鈕再也按不動。
                text, error, cancelled = None, f"轉錄時發生未預期的錯誤：{exc}", False
            result_queue.put(("done", text, error, cancelled))

        def _on_message(message):
            if message[0] == "progress":
                on_progress(message[1])
                return False
            if message[0] == "error":  # poll_queue 安全網（_worker 正常會自己接住）
                on_done(None, f"轉錄時發生未預期的錯誤：{message[1]}", False)
                return True
            text, error, cancelled = message[1], message[2], message[3]
            if text is not None:
                updated_cache = self._cache.write_transcript_text(entry, text)
                self._entry_cache[entry.path] = updated_cache[entry.path]
            on_done(text, error, cancelled)
            return True

        start_worker(_worker, result_queue)
        poll_queue(self, result_queue, _on_message)

    def _on_close(self):
        """關閉視窗前先把播放器停掉、釋放 libvlc 資源，避免留下背景播放中的
        音訊或殘留的 libvlc 執行緒。"""
        self._cancel_media_load_schedule()
        if self._filter_after_id is not None:
            try:
                self.after_cancel(self._filter_after_id)
            except tk.TclError:
                pass
            self._filter_after_id = None
        self._media.release()
        self.destroy()

    # ── 拖曳／手動新增 ───────────────────────────────────────────────

    def _require_write_target(self, action_title):
        """回傳目前可以寫入的單一索引檔案路徑；沒有的話跳出對應原因的警告視窗
        （「全部索引」聚合模式底下沒有單一目標檔案／根本沒有任何索引檔案可用
        兩種情況文字不一樣），回傳 None。"""
        if self._current_index_path is not None:
            return self._current_index_path
        if self._index_var.get() == ALL_INDEXES_LABEL:
            messagebox.showwarning(action_title, "目前是「全部索引」檢視模式，請先切換到指定的索引集才能新增資料。")
        else:
            messagebox.showwarning(action_title, "目前沒有可寫入的索引檔案，請先在 indexes/ 底下建立一份 .md。")
        return None

    def _on_drop_files(self, event):
        self._add_files_manually(self._import.parse_dnd_paths(event.data))

    def _on_add_file_dialog(self):
        paths = filedialog.askopenfilenames(title="選擇要加入索引的檔案")
        if paths:
            self._add_files_manually(paths)

    def _add_files_manually(self, raw_paths):
        """拖曳與「新增檔案...」共用的唯一入口與驗證流程。"""
        if self._require_write_target("新增到索引") is None:
            return
        existing_keys = self._import.existing_path_keys(self._all_entries)
        accepted, missing, folders, duplicates = self._import.normalize_candidates(raw_paths, existing_keys)

        if missing or folders or duplicates:
            notes = []
            if duplicates:
                notes.append(f"略過 {duplicates} 個已收錄或重複選取的檔案")
            if missing:
                notes.append(f"略過 {missing} 個不存在的路徑")
            if folders:
                notes.append(f"略過 {folders} 個資料夾（請使用「匯入資料夾...」）")
            messagebox.showinfo("新增到索引", "\n".join(notes))
        if not accepted:
            return

        # 多檔案逐筆顯示同一個新增視窗，不會像一次迴圈那樣一次疊出多個 modal。
        pending = list(accepted)

        def _open_next():
            if not pending:
                return
            path_str = pending.pop(0)
            self._prompt_add_entry(path_str, on_complete=_open_next)

        _open_next()

    def _on_import_folder(self):
        if self._require_write_target("匯入資料夾") is None:
            return
        folder = filedialog.askdirectory(title="選擇要匯入的資料夾")
        if not folder:
            return
        existing_paths = {path_key(e.path) for e in self._all_entries}
        existing_categories = self._search.distinct_categories(self._all_entries)

        def _on_confirm(new_files, category):
            count = self._import.import_folder(self._current_index_path, new_files, category)
            self._reload_index()
            messagebox.showinfo(
                "匯入資料夾",
                f"已新增 {count} 筆（說明欄留空，之後可用「編輯索引檔案」補上關鍵字）。",
            )

        ImportFolderDialog(self, self._scan, Path(folder), existing_paths, existing_categories, _on_confirm)

    def _prompt_add_entry(self, path_str, on_complete=None):
        target = self._current_index_path  # 呼叫端（拖曳／新增檔案）已經先經過 _require_write_target 檢查過
        existing_categories = self._search.distinct_categories(self._all_entries)

        def _on_confirm(category, desc):
            self._index.add_entry(target, path_str, category, desc)
            self._reload_index()
            if on_complete:
                self.after_idle(on_complete)

        AddEntryDialog(
            self, path_str, existing_categories, _on_confirm,
            on_cancel=on_complete,
        )

    def _selected_path(self):
        entry = self._tree.selected_entry()
        return entry.path if entry else None

    def _on_edit_selected(self):
        """編輯清單裡已經選定的那一列——跟「新增檔案...」共用同一個對話框，
        只是預先填好目前的分類／說明，確認後只改這一列（用 row_index 精確定位，
        寫回它實際的來源索引檔案，不管目前是不是「全部索引」聚合檢視），就算
        同一份索引裡有其他路徑完全相同的列也不會被牽連著一起改掉，也不影響
        它在表格裡的原本位置。"""
        entry = self._tree.selected_entry()
        if entry is None:
            messagebox.showinfo("編輯所選列", "請先在清單中選一筆。")
            return
        existing_categories = self._search.distinct_categories(self._all_entries)

        def _on_confirm(new_category, new_desc):
            updated = self._index.update_entry(entry, new_category, new_desc)
            self._reload_index()
            if not updated:
                messagebox.showwarning(
                    "編輯所選列",
                    "在索引檔案裡找不到這一列了（可能索引檔案剛好被外部修改過），"
                    "請按「重新載入索引」確認目前內容後再試一次。",
                )

        AddEntryDialog(
            self, entry.path, existing_categories, _on_confirm,
            title="編輯索引列", confirm_text="儲存變更",
            initial_category=entry.category, initial_desc=entry.description,
        )

    def _on_delete_selected(self, _event=None):
        """Delete 鍵刪除目前藍色選取列；只改索引檔，不碰實體檔案。用 row_index
        （而不是路徑）精確刪除選定的那一列——同一路徑在同一份索引重複出現時，
        只會刪掉使用者實際選中的那一列，其餘相同路徑的列會完整保留。"""
        entry = self._tree.selected_entry()
        if entry is None:
            return "break"
        if not messagebox.askyesno(
            "確認刪除索引項目",
            f"確定要從索引清單刪除這一筆嗎？\n\n{entry.name}\n{entry.path}\n\n"
            "只會刪除索引紀錄，硬碟上的實體檔案仍會保留。",
            icon="warning",
        ):
            self._tree.focus_set()
            return "break"
        removed = self._index.delete_entry(entry)
        if not removed:
            messagebox.showwarning(
                "刪除索引項目",
                "找不到對應的索引列（可能索引檔案剛被外部修改），請重新載入後再試。",
            )
            return "break"
        self._reload_index()
        self._tree.focus_set()
        return "break"

    # ── 索引清理 ─────────────────────────────────────────────────────

    def _cleanup_missing(self):
        files = self._index.resolve_scope_files(self._current_index_path)
        if not files:
            return
        pending = self._index.preview_cleanup(files)
        total_removed = sum(removed for _f, removed, _t in pending)
        if total_removed == 0:
            messagebox.showinfo("清除失效項目", "目前檢視範圍內沒有找不到檔案的項目。")
            return
        scope = "目前檢視的全部索引集" if len(files) > 1 else f"「{files[0].name}」"
        if not messagebox.askyesno(
            "清除失效項目",
            f"{scope}裡有 {total_removed} 筆索引指向的檔案目前找不到（可能已搬移或刪除）。\n\n"
            "確定要把這幾筆從索引檔案裡刪除嗎？其餘內容不受影響。",
        ):
            return
        self._index.apply_cleanup(pending)
        self._reload_index()
        messagebox.showinfo("清除失效項目", f"已刪除 {total_removed} 筆。")

    def _on_bulk_delete(self):
        if not self._all_entries:
            messagebox.showinfo("批次刪除索引項目", "目前沒有可操作的索引項目。")
            return

        def _on_confirm(entries_to_remove):
            total_removed = self._index.delete_entries(entries_to_remove)
            if total_removed == 0:
                messagebox.showwarning(
                    "批次刪除索引項目",
                    "找不到對應的資料列了（可能索引檔案剛好被外部修改過），"
                    "請按「重新載入索引」確認目前內容後再試一次。",
                )
                return
            self._reload_index()
            messagebox.showinfo("批次刪除索引項目", f"已刪除 {total_removed} 筆。")

        BulkDeleteDialog(self, list(self._all_entries), _on_confirm)

    # ── 內容快取／全文檢索底層 ───────────────────────────────────────

    def _refresh_caches_in_background(self, files, title, initial_text, on_done):
        """在背景更新快取；工作執行緒只寫 Queue，所有 Tkinter 更新留在主執行緒。"""
        grand_total = sum(self._index.entry_count(f) for f in files)
        progress = tk.Toplevel(self)
        progress.title(title)
        progress.configure(bg=COLOR_BG)
        progress.transient(self)
        progress.grab_set()
        progress.resizable(False, False)
        progress.geometry("520x150")
        label_var = tk.StringVar(value=initial_text)
        status_label = tk.Label(
            progress, textvariable=label_var, bg=COLOR_BG, fg=COLOR_MISSING_FG,
            font=self._font_warning, padx=22, pady=0, anchor="w",
            justify="left", wraplength=470,
        )
        status_label.pack(fill="x", pady=(20, 10))
        progress_bar = ttk.Progressbar(progress, maximum=max(1, grand_total), mode="determinate")
        progress_bar.pack(fill="x", padx=22, pady=(0, 18))
        progress.update_idletasks()

        result_queue = queue.Queue()

        def _worker():
            try:
                self._cache.update_cache_for_indexes(
                    files,
                    progress_cb=lambda overall, all_count, fname, done, total:
                        result_queue.put(("progress", overall, all_count, fname, done, total)),
                )
                result_queue.put(("done",))
            except Exception as exc:
                result_queue.put(("error", str(exc)))

        threading.Thread(target=_worker, daemon=True).start()

        def _poll():
            try:
                while True:
                    message = result_queue.get_nowait()
                    if message[0] == "progress":
                        overall, all_count, fname, done, total = message[1:]
                        progress_bar["value"] = overall
                        label_var.set(f"{fname}：{done} / {total}（總進度 {overall} / {all_count}）")
                    elif message[0] == "error":
                        progress.destroy()
                        messagebox.showerror(title, f"更新內容快取失敗：\n{message[1]}")
                        return
                    elif message[0] == "done":
                        progress.destroy()
                        on_done()
                        return
            except queue.Empty:
                pass
            if progress.winfo_exists():
                progress.after(80, _poll)

        progress.protocol("WM_DELETE_WINDOW", lambda: None)
        progress.after(80, _poll)

    def _on_update_cache(self):
        """更新全部索引集的內容快取（SHA-256＋擷取文字）——手動觸發；每次
        都重新驗證檔案內容雜湊，文字內容則只在檔案變動時重新擷取。"""
        files = self._index.list_index_files()
        if not files:
            messagebox.showinfo("更新內容快取", "目前沒有任何索引檔案。")
            return
        total_entries = sum(self._index.entry_count(f) for f in files)
        if total_entries == 0:
            messagebox.showinfo("更新內容快取", "目前索引裡沒有任何項目。")
            return
        if not messagebox.askyesno(
            "更新內容快取",
            f"要更新全部 {len(files)} 份索引集、共 {total_entries} 筆項目的內容快取嗎？\n\n"
            "（會重新驗證全部檔案的 SHA-256；大型影片或檔案很多時可能需要一點時間）",
        ):
            return

        def _done():
            self._reload_index()
            messagebox.showinfo(
                "更新內容快取",
                "快取已更新完成，全文檢索現在會使用最新內容；重複偵測按下時也會再次驗證 SHA-256。",
            )

        self._refresh_caches_in_background(files, "更新內容快取", "準備更新內容快取…", _done)

    # ── 找出未收錄檔案／常用資料夾 ─────────────────────────────────────

    def _on_manage_known_folders(self):
        KnownFoldersDialog(self, self._metadata.load_known_folders, self._metadata.save_known_folders)

    def _on_find_unindexed(self):
        files = self._index.list_index_files()
        if not files:
            messagebox.showinfo("找出未收錄檔案", "目前沒有任何索引檔案可以加入，請先建立一份 .md。")
            return
        all_entries = self._index.all_entries_in(files)
        existing_paths_all = {path_key(e.path) for e in all_entries}
        existing_categories = self._search.distinct_categories(all_entries)
        default_index = self._current_index_path or files[0]

        def _on_confirm(new_files, target, category):
            count = self._import.import_folder(target, new_files, category)
            self._reload_index()
            messagebox.showinfo(
                "找出未收錄檔案",
                f"已新增 {count} 筆到「{target.name}」（說明欄留空，之後可用「批次補說明...」或「編輯所選列」補上）。",
            )

        UnindexedScanDialog(
            self, self._scan, self._metadata.load_known_folders, existing_paths_all, existing_categories,
            files, default_index, _on_confirm, self._on_manage_known_folders,
        )

    # ── 重複檔案偵測 ─────────────────────────────────────────────────

    def _on_find_duplicates(self):
        """跨全部索引集依檔案大小＋SHA-256 分組。

        每次按下按鈕都先重新驗證所有索引項目的雜湊，避免新加入的檔案尚未建立
        快取，或檔案內容變更後仍沿用舊結果，造成明明相同卻漏判。"""
        files = self._index.list_index_files()
        if not files:
            messagebox.showinfo("重複檔案偵測", "目前沒有任何索引檔案。")
            return

        total_entries = sum(self._index.entry_count(f) for f in files)
        if total_entries == 0:
            messagebox.showinfo("重複檔案偵測", "目前索引裡沒有任何項目。")
            return

        def _after_hash_refresh():
            self._reload_index()
            groups = self._duplicate.group(files)
            if not groups:
                messagebox.showinfo(
                    "重複檔案偵測",
                    "已重新驗證全部索引項目的 SHA-256，目前沒有找到內容完全相同的檔案。\n\n"
                    "檔名相同不代表檔案內容相同；只要任何標籤、音訊資料或位元內容不同，SHA-256 就會不同。",
                )
                return

            def _on_confirm(entries_to_delete):
                total_removed = self._duplicate.remove_entries(entries_to_delete)
                self._reload_index()
                messagebox.showinfo("重複檔案偵測", f"已刪除 {total_removed} 筆重複的索引紀錄。")

            DuplicateDialog(self, groups, _on_confirm)

        self._refresh_caches_in_background(
            files, "重複檔案偵測", "正在重新驗證全部檔案的 SHA-256…", _after_hash_refresh,
        )

    # ── 批次補齊說明 ─────────────────────────────────────────────────

    def _on_batch_describe(self):
        """對目前檢視範圍內「說明是空的」項目，用內容擷取邏輯產生建議說明，
        開審核畫面讓使用者逐筆看過/修改/決定要不要套用，確認後才寫入。"""
        self._reload_index()
        blanks = self._description.find_blank_entries(self._filtered_entries)
        if not blanks:
            messagebox.showinfo("批次補齊說明", "目前檢視範圍內沒有說明是空的項目。")
            return

        def _on_confirm(items):
            total = self._description.apply_updates(items)
            self._reload_index()
            messagebox.showinfo("批次補齊說明", f"已更新 {total} 筆說明。")

        # 文字擷取改在背景執行；主執行緒只輪詢進度，視窗不再整段凍結。
        progress = tk.Toplevel(self)
        progress.title("準備批次說明")
        progress.configure(bg=COLOR_BG)
        progress.transient(self)
        progress.grab_set()
        progress.resizable(False, False)
        progress.geometry("520x175")
        status_var = tk.StringVar(value=f"準備讀取 {len(blanks)} 個檔案…")
        tk.Label(
            progress, textvariable=status_var, bg=COLOR_BG, font=self._font_label,
            anchor="w", justify="left", wraplength=470,
        ).pack(fill="x", padx=20, pady=(20, 10))
        progress_bar = ttk.Progressbar(progress, maximum=len(blanks), mode="determinate")
        progress_bar.pack(fill="x", padx=20)
        cancel_event = threading.Event()
        styled_button(
            progress, "取消", lambda: cancel_event.set(),
            BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, self._font_hint,
        ).pack(side="right", padx=20, pady=14)
        progress.protocol("WM_DELETE_WINDOW", cancel_event.set)

        result_queue = queue.Queue()
        cache_snapshot = self._entry_cache  # 目前已載入的內容快取，背景執行緒只讀不寫

        def _worker():
            try:
                suggestions, cancelled = self._description.generate_suggestions(
                    blanks, cache_snapshot,
                    progress_cb=lambda done, name: result_queue.put(("progress", done, name)),
                    cancel_check=cancel_event.is_set,
                )
                result_queue.put(("cancelled" if cancelled else "done", suggestions))
            except Exception as exc:  # noqa: BLE001
                result_queue.put(("failed", str(exc)))

        threading.Thread(target=_worker, daemon=True).start()

        def _poll_worker():
            try:
                while True:
                    message = result_queue.get_nowait()
                    kind = message[0]
                    if kind == "progress":
                        done, name = message[1], message[2]
                        progress_bar["value"] = done
                        status_var.set(f"正在擷取文字：{done} / {len(blanks)}\n{name}")
                    elif kind == "failed":
                        progress.destroy()
                        messagebox.showerror("批次補齊說明", f"擷取內容時發生未預期的錯誤：\n{message[1]}")
                        return
                    elif kind in ("done", "cancelled"):
                        suggestions = message[1]
                        progress.destroy()
                        if kind == "cancelled":
                            return
                        if not suggestions:
                            messagebox.showinfo(
                                "批次補齊說明",
                                "說明是空的項目，對應的檔案目前都找不到，沒有內容可以擷取。",
                            )
                            return
                        BatchDescribeDialog(self, suggestions, _on_confirm)
                        return
            except queue.Empty:
                pass
            if progress.winfo_exists():
                progress.after(80, _poll_worker)

        progress.after(80, _poll_worker)

    # ── AI 批次說明（獨立入口，跟人工批次補說明完全分開）───────────────

    def _build_ai_settings_hint(self, parent) -> tk.Canvas:
        """「AI 設定 / 點這裡」對話框泡泡：圓角外框＋左側指向按鈕的小尾巴。
        外圈有一圈橙色光暈，每 ~1.7 秒像呼吸一樣往外脹大＋淡出、再縮回＋變濃，
        同時泡泡底色一起深淺變化——餘光就注意得到，又不到刺眼的程度。
        全程一張 Canvas，動畫只改既有圖元的座標／顏色，不重建圖元。"""
        w, h = 130, 74
        cx1, cy1, cx2, cy2, r = 18, 12, w - 10, h - 12, 12
        self._ai_hint_box = (cx1, cy1, cx2, cy2, r)
        tail = [cx1 + 2, h // 2 - 9, 4, h // 2, cx1 + 2, h // 2 + 9]
        canvas = tk.Canvas(parent, width=w, height=h, bg=COLOR_BG, highlightthickness=0, cursor="hand2")
        # 外圈光暈：只有描邊，靠改座標（往外脹）＋改顏色（淡出到工具列底色）做出呼吸感。
        self._ai_hint_halo = canvas.create_polygon(
            _round_rect_points(cx1 - 1, cy1 - 1, cx2 + 1, cy2 + 1, r + 1),
            smooth=True, fill="", outline=_AI_HINT_BORDER_HI, width=3,
        )
        canvas.create_polygon(tail, fill=_AI_HINT_BG, outline=_AI_HINT_BORDER, width=2)
        self._ai_hint_body = canvas.create_polygon(
            _round_rect_points(cx1, cy1, cx2, cy2, r),
            smooth=True, fill=_AI_HINT_BG, outline=_AI_HINT_BORDER, width=2,
        )
        canvas.create_text(
            (cx1 + cx2) // 2 + 1, (cy1 + cy2) // 2, text="AI 設定\n點這裡",
            fill=_AI_HINT_FG, font=self._font_warning, justify="center",
        )
        canvas.tag_bind("all", "<Button-1>", lambda _e: self._on_ai_batch_describe())
        self._ai_hint_canvas = canvas
        self._ai_hint_phase = 0.0
        self._ai_hint_dir = 1
        self._animate_ai_settings_hint()
        return canvas

    def _animate_ai_settings_hint(self):
        canvas = self._ai_hint_canvas
        if not canvas.winfo_exists():
            return
        self._ai_hint_phase += self._ai_hint_dir * (_AI_HINT_FPS_MS / _AI_HINT_PERIOD_MS)
        if self._ai_hint_phase >= 1:
            self._ai_hint_phase, self._ai_hint_dir = 1.0, -1
        elif self._ai_hint_phase <= 0:
            self._ai_hint_phase, self._ai_hint_dir = 0.0, 1
        # smoothstep：兩端慢、中間快，起伏像呼吸而不是硬閃
        t = self._ai_hint_phase
        ease = t * t * (3 - 2 * t)
        cx1, cy1, cx2, cy2, r = self._ai_hint_box
        glow = 1 + _AI_HINT_GLOW_MAX * ease  # 光暈往外脹的距離
        canvas.coords(
            self._ai_hint_halo,
            *_round_rect_points(cx1 - glow, cy1 - glow, cx2 + glow, cy2 + glow, r + glow),
        )
        canvas.itemconfigure(
            self._ai_hint_halo,
            outline=_lerp_color(_AI_HINT_BORDER_HI, COLOR_BG, ease),  # 脹大時淡出
            width=max(1, round(4 - 3 * ease)),
        )
        canvas.itemconfigure(
            self._ai_hint_body,
            outline=_lerp_color(_AI_HINT_BORDER, _AI_HINT_BORDER_HI, ease),
            fill=_lerp_color(_AI_HINT_BG, _AI_HINT_BG_HI, ease),
        )
        self.after(_AI_HINT_FPS_MS, self._animate_ai_settings_hint)

    def _on_open_ai_settings(self, on_saved=None):
        AISettingsDialog(self, self._ai_settings_repo, self._ai_description, on_saved=on_saved)

    def _on_ai_batch_describe(self):
        """跟「✍️ 批次補說明...」不同：這裡先開一個可搜尋、可勾選的清單（預設
        全部不勾選），使用者自己決定要花 token／時間送哪幾筆給 AI，確認送出
        後才真的呼叫；跑完的建議另外開一個審核視窗（沿用批次補說明同一套
        審核／編輯／套用畫面）逐筆確認才會寫進索引。"""
        self._reload_index()
        blanks = self._description.find_blank_entries(self._filtered_entries)
        if not blanks:
            messagebox.showinfo("AI 批次說明", "目前檢視範圍內沒有說明是空的項目。")
            return
        AISelectDialog(
            self, blanks, self._ai_description,
            on_open_ai_settings=self._on_open_ai_settings,
            on_run=self._on_ai_regenerate_batch,
            on_finished=self._on_ai_batch_finished,
        )

    def _on_ask_ai_about_file(self):
        """「🔬 選檔案問 AI...」：自選任何一個檔案送目前設定的 Provider 分析，
        只把回覆顯示出來供查看，不寫回任何索引。確認視窗會把「送去 Ollama
        還是 OpenAI、哪個模型、內容會不會離開這台電腦」講清楚。"""
        ok, reason = self._ai_description.is_configured()
        if not ok:
            messagebox.showwarning("選檔案問 AI", f"{reason}，請先按「⚙️ AI 設定...」設定好再試一次。")
            return
        path = filedialog.askopenfilename(title="選擇要送給 AI 分析的檔案")
        if not path:
            return

        target = self._ai_description.current_target_summary()
        call_count = self._ai_description.get_call_count()
        name = Path(path).name
        body = (
            f"即將把檔案「{name}」擷取到的內容送出分析。\n\n"
            f"{self._ai_description.target_disclosure_lines()}\n\n"
            f"這是全部 AI 功能累計第 {call_count + 1} 次呼叫"
            "（僅供參考，實際費用/額度以 Provider 帳單為準）。\n\n"
            "分析結果只會顯示出來供你查看，不會寫進任何索引。"
        )
        confirm_text = "送到 OpenAI 分析" if target["provider"] == "openai" else "送到 Ollama 分析"
        if not ask_ai_confirm(self, self._ai_description.target_confirm_title(), body, confirm_text=confirm_text):
            return

        progress = tk.Toplevel(self)
        progress.title("AI 分析中")
        progress.configure(bg=COLOR_BG)
        progress.transient(self)
        progress.grab_set()
        progress.resizable(False, False)
        progress.geometry("460x140")
        tk.Label(
            progress, text=f"正在把「{name}」送去 {target['label']} 分析…\n（視檔案大小與模型速度，可能需要數秒到數十秒）",
            bg=COLOR_BG, font=self._font_hint, anchor="w", justify="left", wraplength=420,
        ).pack(fill="x", padx=20, pady=(18, 10))
        bar = ttk.Progressbar(progress, mode="indeterminate")
        bar.pack(fill="x", padx=20)
        bar.start(12)
        progress.protocol("WM_DELETE_WINDOW", lambda: None)  # 分析中不讓關，避免留下孤兒執行緒狀態

        result_queue = queue.Queue()

        def _worker():
            try:
                answer, error, info = self._ai_description.analyze_file(path)
            except Exception as exc:  # 防禦：Service 內任何未預期例外都不該讓輪詢卡住
                answer, error, info = None, f"分析時發生未預期的錯誤：{exc}", {
                    "target": target, "kind": None, "sent_desc": ""
                }
            result_queue.put((answer, error, info))

        threading.Thread(target=_worker, daemon=True).start()

        def _poll():
            try:
                answer, error, info = result_queue.get_nowait()
            except queue.Empty:
                self.after(120, _poll)
                return
            bar.stop()
            progress.destroy()
            if error:
                messagebox.showerror("選檔案問 AI", f"分析失敗：\n\n{error}")
                return
            AIAnalyzeResultDialog(
                self, file_path=path, file_name=name,
                target=info.get("target", target), kind=info.get("kind"), answer=answer,
            )

        self.after(120, _poll)

    @staticmethod
    def _summarize_ai_errors(failed_items, limit=3):
        """把失敗原因去重、統計次數，最多列出 limit 種——呼叫 AI 失敗時使用者
        看到的不能只有一個數字，不然完全沒辦法判斷是 Key 錯了、模型名稱打錯、
        還是網路問題。"""
        if not failed_items:
            return ""
        counts = {}
        for _entry, err in failed_items:
            counts[err] = counts.get(err, 0) + 1
        lines = [f"・{msg}（{count} 筆）" for msg, count in list(counts.items())[:limit]]
        if len(counts) > limit:
            lines.append(f"…等共 {len(counts)} 種不同原因")
        return "\n".join(lines)

    def _on_ai_batch_finished(self, results):
        """AISelectDialog 真的跑完一批（不是取消／未設定）才會呼叫進來。
        results: [(IndexEntry, suggestion_or_None, error_or_None), ...]。"""
        succeeded = [(entry, sug) for entry, sug, err in results if sug is not None]
        skipped = sum(1 for _e, sug, err in results if sug is None and err is None)
        failed_items = [(entry, err) for entry, sug, err in results if err is not None]
        failed = len(failed_items)
        error_detail = self._summarize_ai_errors(failed_items)
        if not succeeded:
            messagebox.showinfo(
                "AI 批次說明",
                f"沒有成功產生任何建議說明（{skipped} 筆沒有可摘要的內容，{failed} 筆呼叫失敗）。"
                + (f"\n\n失敗原因：\n{error_detail}" if error_detail else ""),
            )
            return
        if skipped or failed:
            messagebox.showinfo(
                "AI 批次說明",
                f"已產生 {len(succeeded)} 筆建議，接下來可以逐筆確認。"
                f"（另有 {skipped} 筆沒有可摘要的內容、{failed} 筆呼叫失敗，未列入審核清單）"
                + (f"\n\n失敗原因：\n{error_detail}" if error_detail else ""),
            )

        def _on_confirm(items):
            total = self._description.apply_updates(items)
            self._reload_index()
            messagebox.showinfo("AI 批次說明", f"已套用 {total} 筆說明。")

        BatchDescribeDialog(self, succeeded, _on_confirm)

    def _on_ai_regenerate_batch(self, entries, on_progress, on_done, cancel_event):
        """AISelectDialog 送出勾選項目時呼叫——先確認設定齊全、跳出確認視窗
        （OpenAI 這種內容會離開本機的情況一定要問過），確認後才在背景執行緒
        逐筆呼叫 AI；背景執行緒只呼叫 Service、把結果放進 Queue，Tkinter
        更新（on_progress／on_done，實際上是改 Dialog 裡的 Label／StringVar）
        留在主執行緒的 after() 輪詢裡做。"""
        ok, reason = self._ai_description.is_configured()
        if not ok:
            messagebox.showwarning("AI 批次產生說明", f"{reason}，請先按「⚙️ AI 設定...」設定好再試一次。")
            on_done(None)
            return

        n = len(entries)
        # 用量／花費是使用者完全看不到的東西：這裡逐筆呼叫 AI，筆數一多送出
        # 的內容量／呼叫次數就跟著變大。跟便利貼「AI 搜尋」共用同一顆持久化
        # 計數器（AIDescriptionService.get_call_count()），讓使用者至少知道
        # 「這是全部 AI 功能加起來第幾次呼叫」；大小估計用 CACHE_TEXT_CHARS
        # 這個既有常數當粗略上限，不會為了算精確值而先把每個檔案的內容都讀
        # 一遍（可能很慢，尤其舊版 Office 格式要透過 COM 自動化，逐一開檔會
        # 拖慢跳出這個確認視窗的速度）。
        image_count = sum(1 for e in entries if e.path_obj.suffix.lower() in IMAGE_EXTS)
        text_like_count = n - image_count
        size_parts = []
        if text_like_count:
            size_parts.append(f"文字/媒體類最多約 {text_like_count} 筆 × {CACHE_TEXT_CHARS:,} 字元（實際通常更短，這是上限）")
        if image_count:
            size_parts.append(f"另有 {image_count} 張圖片會用視覺模型分析（計費方式跟文字不同，以 Provider 說明為準）")
        size_hint = "；".join(size_parts)
        call_count = self._ai_description.get_call_count()
        usage_hint = (
            f"這是全部 AI 功能（AI 搜尋＋AI 批次說明共用）累計第 {call_count + 1}～{call_count + n} 次呼叫"
            "（僅供參考，實際費用/額度以 Provider 帳單為準）。"
        )
        proceed = ask_ai_confirm(
            self,
            self._ai_description.target_confirm_title(),
            f"即將把這 {n} 筆檔案擷取到的內容片段送出，逐筆呼叫產生建議說明"
            f"（數量多時需要一點時間）。\n\n"
            f"{self._ai_description.target_disclosure_lines()}\n\n"
            f"預估內容量：{size_hint}\n{usage_hint}",
        )
        if not proceed:
            on_done(None)
            return

        result_queue = queue.Queue()

        def _worker():
            try:
                results, _cancelled = self._ai_description.generate_suggestions(
                    entries, self._entry_cache,
                    progress_cb=lambda done, name: result_queue.put(("progress", done, name)),
                    cancel_check=cancel_event.is_set,
                )
                result_queue.put(("done", results))
            except Exception as exc:  # noqa: BLE001
                # generate_suggestions 內部只攔 AIProviderError；任何其他未預期
                # 例外（Provider 回應格式怪、第三方套件自己的錯…）都要送回佇列，
                # 否則 _poll 每 100ms 空轉、AISelectDialog 的送出鈕永遠停用。
                result_queue.put(("failed", str(exc)))

        def _on_message(message):
            if message[0] == "progress":
                on_progress(message[1], n, message[2])
                return False
            if message[0] == "done":
                on_done(message[1])
                return True
            # "failed"（_worker 自己包的）或 "error"（poll_queue 安全網）
            messagebox.showerror("AI 批次產生說明", f"產生說明時發生未預期的錯誤：\n{message[1]}")
            on_done(None)
            return True

        start_worker(_worker, result_queue)
        poll_queue(self, result_queue, _on_message)

    # ── 結果操作 ─────────────────────────────────────────────────────

    def _open_selected(self):
        path = self._selected_path()
        if not path:
            messagebox.showinfo("開啟檔案", "請先在清單中選一筆。")
            return
        if not Path(path).exists():
            messagebox.showerror("開啟檔案", f"檔案不存在，可能已搬移或刪除：\n{path}")
            return
        try:
            file_actions.open_file(path)
        except OSError as e:
            messagebox.showerror("開啟檔案", f"開啟失敗：{e}")

    def _reveal_selected(self):
        path = self._selected_path()
        if not path:
            messagebox.showinfo("顯示於檔案總管", "請先在清單中選一筆。")
            return
        file_path = Path(path).resolve()
        if not file_path.exists():
            messagebox.showerror("顯示於檔案總管", f"檔案不存在，可能已搬移或刪除：\n{file_path}")
            return
        try:
            file_actions.reveal_in_explorer(file_path)
        except OSError as e:
            messagebox.showerror("顯示於檔案總管", f"無法開啟檔案總管：\n{e}")

    def _copy_selected_path(self):
        path = self._selected_path()
        if not path:
            messagebox.showinfo("複製路徑", "請先在清單中選一筆。")
            return
        file_actions.copy_to_clipboard(self, path)

    def _open_index_file(self):
        """用文字編輯器開目前這份索引 .md 方便新增/修改。"""
        if self._require_write_target("編輯索引檔案") is None:
            return
        try:
            file_actions.open_in_text_editor(self._current_index_path)
        except OSError as e:
            messagebox.showerror("編輯索引檔案", f"開啟失敗：{e}")

    def _focus_search(self, _event=None):
        self._search_entry.focus_set()
        self._search_entry.select_range(0, "end")
        return "break"

    def _clear_search(self, event=None):
        # bind_all 會收到子對話框與影片大視窗的 Esc；只允許主視窗本身及其子元件
        # 清空搜尋，避免在 Dialog 按 Esc 時偷偷改變背景搜尋結果。
        if event is not None:
            try:
                if event.widget.winfo_toplevel() is not self:
                    return None
            except tk.TclError:
                return None
        self._search_var.set("")
        return "break"
