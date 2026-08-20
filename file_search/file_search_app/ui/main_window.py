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
    ALL_INDEXES_LABEL, BTN_BLUE_ACTIVE, BTN_BLUE_BG, BTN_CYAN_ACTIVE, BTN_CYAN_BG,
    BTN_DANGER_ACTIVE, BTN_DANGER_BG, BTN_INDIGO_ACTIVE, BTN_INDIGO_BG,
    BTN_ORANGE_ACTIVE, BTN_ORANGE_BG, BTN_PINK_ACTIVE, BTN_PINK_BG,
    BTN_PRIMARY_ACTIVE, BTN_PRIMARY_BG, BTN_PURPLE_ACTIVE, BTN_PURPLE_BG,
    BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, BTN_TEAL_ACTIVE, BTN_TEAL_BG,
    BTN_WARN_ACTIVE, BTN_WARN_BG, COLOR_BG, COLOR_HEADER_BG, COLOR_HEADER_FG,
    COLOR_HEADER_SUB_FG, COLOR_MISSING_FG, COLOR_STATUS_FG, FONT_FAMILY, INDEXES_DIR,
    MEDIA_EXTS, PREVIEW_DEFAULT_WIDTH, PREVIEW_GRIP_WIDTH, PREVIEW_MIN_WIDTH, TREE_MIN_WIDTH,
)
from file_search_app.media.media_controller import MediaController
from file_search_app.platform import file_actions
from file_search_app.ui.dialogs.delete_dialogs import BulkDeleteDialog
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

_BaseTk = TkinterDnD.Tk if _HAS_DND else tk.Tk


class MainWindow(_BaseTk):
    def __init__(
        self, *, index_service, search_service, import_service, scan_service,
        duplicate_service, description_service, cache_service, preview_service,
        metadata_repo, ai_description_service, ai_settings_repo, transcription_service,
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
        self._entry_cache = {}       # path_str -> {mtime,size,hash,text}，牽涉到的索引集內容快取合併
        self._current_index_path = None  # None 且選單顯示「全部索引」＝聚合模式；None 且選單是空的＝沒有任何索引可用
        self._preview_width = PREVIEW_DEFAULT_WIDTH
        self._preview_drag_start_x = None
        self._preview_drag_start_width = None

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
            index_picker, "➕ 新增索引集...", self._on_create_index, BTN_BLUE_BG, BTN_BLUE_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(10, 0))
        styled_button(
            index_picker, "🗑️ 刪除索引集", self._on_delete_index,
            BTN_DANGER_BG, BTN_DANGER_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))

        HelpBar(self)

        toolbar = tk.Frame(self, bg=COLOR_BG)
        toolbar.pack(fill="x", padx=16, pady=(12, 6))
        tk.Label(toolbar, text="🔍", bg=COLOR_BG, font=self._font_search).pack(side="left", padx=(0, 6))
        self._search_var = tk.StringVar()
        self._search_entry = tk.Entry(toolbar, textvariable=self._search_var, font=self._font_search, relief="flat")
        self._search_entry.pack(side="left", fill="x", expand=True, ipady=6)
        self._search_var.trace_add("write", lambda *_a: self._apply_filter())

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
        tk.Label(folder_box, text="資料夾：", bg="#dbeafe", fg="#1e3a8a", font=self._font_label).pack(side="left", padx=(0, 4))
        self._folder_var = tk.StringVar(value="全部")
        self._folder_combo = ttk.Combobox(
            folder_box, textvariable=self._folder_var, state="readonly",
            font=self._font_label, style="Medium.TCombobox", width=18,
        )
        self._folder_combo.pack(side="left")
        self._folder_combo.bind("<<ComboboxSelected>>", lambda _e: self._apply_filter())

        toolbar2 = tk.Frame(self, bg=COLOR_BG)
        toolbar2.pack(fill="x", padx=16, pady=(0, 6))
        styled_button(
            toolbar2, "新增檔案...", self._on_add_file_dialog, BTN_BLUE_BG, BTN_BLUE_ACTIVE, self._font_hint,
        ).pack(side="left")
        styled_button(
            toolbar2, "匯入資料夾...", self._on_import_folder, BTN_TEAL_BG, BTN_TEAL_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            toolbar2, "編輯索引檔案", self._open_index_file, BTN_INDIGO_BG, BTN_INDIGO_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            toolbar2, "重新載入索引", self._reload_index, BTN_CYAN_BG, BTN_CYAN_ACTIVE, self._font_hint,
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
            toolbar3, "🔄 更新內容快取", self._on_update_cache, BTN_CYAN_BG, BTN_CYAN_ACTIVE, self._font_hint,
        ).pack(side="left")
        styled_button(
            toolbar3, "🔎 找出未收錄檔案...", self._on_find_unindexed, BTN_PRIMARY_BG, BTN_PRIMARY_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            toolbar3, "🧬 重複偵測...", self._on_find_duplicates, BTN_ORANGE_BG, BTN_ORANGE_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            toolbar3, "✍️ 批次補說明...", self._on_batch_describe, BTN_PURPLE_BG, BTN_PURPLE_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            toolbar3, "🤖 AI 批次說明...", self._on_ai_batch_describe, BTN_INDIGO_BG, BTN_INDIGO_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))

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
            transcription_available=self._transcription.available,
            get_cached_text=self._get_cached_text_for,
            on_transcribe_request=self._on_transcribe_request,
        )
        self._preview.frame.pack(side="left", fill="y")

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
            action_bar, "📋 複製路徑", self._copy_selected_path, BTN_PINK_BG, BTN_PINK_ACTIVE, self._font_label,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            action_bar, "✏️ 編輯所選列", self._on_edit_selected, BTN_INDIGO_BG, BTN_INDIGO_ACTIVE, self._font_label,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            action_bar, "⤒ 第一筆", lambda: self._tree.jump_to_edge(False),
            BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, self._font_hint,
        ).pack(side="left", padx=(8, 0))
        styled_button(
            action_bar, "⤓ 最後一筆", lambda: self._tree.jump_to_edge(True),
            BTN_BLUE_BG, BTN_BLUE_ACTIVE, self._font_hint,
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

    def _apply_filter(self):
        typed = self._search_var.get().strip()
        wanted_category = self._category_var.get()
        wanted_folder = self._folder_var.get()
        filtered = self._search.filter_entries(self._all_entries, typed, wanted_category, wanted_folder, self._entry_cache)
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

    def _sync_body_layout(self):
        """統一依「目前視窗實際寬度」重新分配清單／拉桿／預覽區塊的寬度：預覽
        區塊夾在 [PREVIEW_MIN_WIDTH, 視窗寬度扣掉拉桿跟清單至少要留的寬度] 之間，
        清單則拿走剩下的全部空間——上限用即時量到的寬度算，所以真的可以一路
        拉到接近清單只剩最小寬度、預覽區塊貼到視窗左邊界，也能在整個視窗被
        拉大/縮小時自動重新分配，不會有一塊被擠到看不見或超出視窗。"""
        self._body_frame.update_idletasks()
        body_w = self._body_frame.winfo_width()
        if body_w <= 1:
            return  # 視窗還沒真正繪製出來，量到的寬度沒有意義，先跳過
        max_preview = max(PREVIEW_MIN_WIDTH, body_w - PREVIEW_GRIP_WIDTH - 10 - TREE_MIN_WIDTH)
        preview_w = int(max(PREVIEW_MIN_WIDTH, min(self._preview_width, max_preview)))
        self._preview_width = preview_w
        self._preview.resize(preview_w)
        self._tree.configure_width(max(TREE_MIN_WIDTH, body_w - PREVIEW_GRIP_WIDTH - 10 - preview_w))

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

    def _on_media_arrow(self, _event, delta_ms):
        """影片播放時左右鍵各倒退／快轉 5 秒；沒有載入影片就保留 Treeview 導覽。"""
        if not self._media.current_path or not self._media.is_video:
            return None
        self._media.seek_by(delta_ms)
        return "break"

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
            text, error, cancelled = self._transcription.transcribe(
                Path(entry.path),
                progress_cb=lambda fraction: result_queue.put(("progress", fraction)),
                cancel_check=cancel_event.is_set,
            )
            result_queue.put(("done", text, error, cancelled))

        threading.Thread(target=_worker, daemon=True).start()

        def _poll():
            try:
                while True:
                    message = result_queue.get_nowait()
                    if message[0] == "progress":
                        on_progress(message[1])
                    elif message[0] == "done":
                        text, error, cancelled = message[1], message[2], message[3]
                        if text is not None:
                            updated_cache = self._cache.write_transcript_text(entry, text)
                            self._entry_cache[entry.path] = updated_cache[entry.path]
                        on_done(text, error, cancelled)
                        return
            except queue.Empty:
                pass
            self.after(100, _poll)

        self.after(100, _poll)

    def _on_close(self):
        """關閉視窗前先把播放器停掉、釋放 libvlc 資源，避免留下背景播放中的
        音訊或殘留的 libvlc 執行緒。"""
        self._cancel_media_load_schedule()
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
        existing_paths = {str(Path(e.path)) for e in self._all_entries}
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
        existing_paths_all = {str(Path(e.path)) for e in all_entries}
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
        blanks = self._description.find_blank_entries(self._all_entries)
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
            suggestions, cancelled = self._description.generate_suggestions(
                blanks, cache_snapshot,
                progress_cb=lambda done, name: result_queue.put(("progress", done, name)),
                cancel_check=cancel_event.is_set,
            )
            result_queue.put(("cancelled" if cancelled else "done", suggestions))

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

    def _on_open_ai_settings(self, on_saved=None):
        AISettingsDialog(self, self._ai_settings_repo, self._ai_description, on_saved=on_saved)

    def _on_ai_batch_describe(self):
        """跟「✍️ 批次補說明...」不同：這裡先開一個可搜尋、可勾選的清單（預設
        全部不勾選），使用者自己決定要花 token／時間送哪幾筆給 AI，確認送出
        後才真的呼叫；跑完的建議另外開一個審核視窗（沿用批次補說明同一套
        審核／編輯／套用畫面）逐筆確認才會寫進索引。"""
        self._reload_index()
        blanks = self._description.find_blank_entries(self._all_entries)
        if not blanks:
            messagebox.showinfo("AI 批次說明", "目前檢視範圍內沒有說明是空的項目。")
            return
        AISelectDialog(
            self, blanks, self._ai_description,
            on_open_ai_settings=self._on_open_ai_settings,
            on_run=self._on_ai_regenerate_batch,
            on_finished=self._on_ai_batch_finished,
        )

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

    def _on_ai_regenerate_batch(self, entries, on_progress, on_done):
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
        if self._ai_description.is_cloud_provider():
            proceed = messagebox.askyesno(
                "確認送出到 OpenAI",
                f"即將把這 {n} 筆檔案擷取到的內容片段送到 OpenAI 產生說明，"
                "內容會離開這台電腦，且每筆都會呼叫一次可能計費的 API。\n\n確定要繼續嗎？",
            )
        else:
            provider_label = self._ai_description.current_provider_label()
            proceed = messagebox.askyesno(
                "AI 批次產生說明",
                f"要用 {provider_label} 為這 {n} 筆重新產生建議說明嗎？（逐筆呼叫，數量多時需要一點時間）",
            )
        if not proceed:
            on_done(None)
            return

        result_queue = queue.Queue()

        def _worker():
            results, _cancelled = self._ai_description.generate_suggestions(
                entries, self._entry_cache,
                progress_cb=lambda done, name: result_queue.put(("progress", done, name)),
            )
            result_queue.put(("done", results))

        threading.Thread(target=_worker, daemon=True).start()

        def _poll():
            try:
                while True:
                    message = result_queue.get_nowait()
                    if message[0] == "progress":
                        done, name = message[1], message[2]
                        on_progress(done, n, name)
                    elif message[0] == "done":
                        on_done(message[1])
                        return
            except queue.Empty:
                pass
            self.after(100, _poll)

        self.after(100, _poll)

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
