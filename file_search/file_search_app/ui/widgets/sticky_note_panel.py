"""左側常駐便利貼面板——顯示彩色小卡片清單（依標籤自動配色），提供關鍵字＋
標籤篩選、AI 自然語言搜尋、單擊複製、右鍵選單編輯／刪除，頂端「➕新增」
「♻垃圾桶」「📤匯出」「📥匯入資料」「💾匯出資料」「🗑️批次刪除」按鈕跟
空白處右鍵「新增便利貼」。「📤匯出」是給人看的 Markdown 文件；「💾匯出
資料」／「📥匯入資料」是給程式讀回去用的 JSON，給搬家／備份用（見
_on_export_json／_on_import_json）。「刪除」（單筆或批次）現在只是移到
垃圾桶，不是真的消失——「♻垃圾桶」按鈕可以復原或永久刪除（見
_on_trash／StickyNoteTrashDialog）。面板本身只管畫面與
使用者互動，資料的存取／篩選／配色規則都委派給建構子注入的
StickyNoteService，不在這裡碰 JSON 或檔案路徑；呼叫 AI 的設定/連線邏輯則
委派給建構子注入的 AIDescriptionService（跟「AI 批次說明」共用同一套設定，
不用另外設定一次）。

展開/收合、寬度調整都由 MainWindow 統一管理（跟 PreviewPanel 同一套模式）：
這裡只提供 `.frame`（給 MainWindow pack/pack_forget）跟 `.resize(width)`，
收合按鈕透過建構子傳入的 `on_collapse` 回呼，實際切換交還給呼叫端。"""

import queue
import tkinter as tk
from datetime import datetime
from tkinter import filedialog, font as tkfont, messagebox, ttk

from file_search_app.ai.base import AIProviderError
from file_search_app.config import (
    BTN_AI_ACTIVE, BTN_AI_BG, BTN_CREATE_ACTIVE, BTN_CREATE_BG, BTN_DANGER_ACTIVE,
    BTN_DANGER_BG, BTN_EDIT_ACTIVE, BTN_EDIT_BG, BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG,
    BTN_IMPORT_ACTIVE, BTN_IMPORT_BG,
    COLOR_PREVIEW_BG, COLOR_PREVIEW_BORDER, COLOR_STATUS_FG, FONT_FAMILY,
    STICKY_AI_SEARCH_LARGE_NOTE_COUNT, STICKY_CARD_BORDER_DARKEN, STICKY_CARD_FOLD_DARKEN,
    STICKY_CARD_FOLD_SIZE, STICKY_CARD_HOVER_DARKEN, STICKY_CARD_META_COLOR,
    STICKY_CARD_TEXT_COLOR, STICKY_DUE_OVERDUE_BG, STICKY_DUE_OVERDUE_FG, STICKY_DUE_SOON_BG,
    STICKY_DUE_SOON_FG, STICKY_FILTER_BOX_BG, STICKY_FILTER_BOX_BORDER, STICKY_FILTER_BOX_FG,
    STICKY_ICON_BUTTON_SIZE, STICKY_TOAST_BG, STICKY_TOAST_FG, STICKY_TOGGLE_SHORTCUT,
    STICKY_TOOLTIP_BG, STICKY_TOOLTIP_FG,
)
from file_search_app.models import format_added_at
from file_search_app.platform import file_actions
from file_search_app.repositories.notes_settings_repository import NotesSettingsRepository
from file_search_app.services.note_semantic_service import NoteSemanticService
from file_search_app.services.sticky_note_service import (
    REPEAT_LABELS, due_status, format_due_label, preview_text,
)
from file_search_app.ui.async_task import poll_queue, start_worker
from file_search_app.ui.dialogs.ai_confirm_dialog import ask_ai_confirm
from file_search_app.ui.dialogs.scrollable_message_dialog import show_scrollable_message
from file_search_app.ui.dialogs.sticky_note_batch_recategorize_dialog import (
    StickyNoteBatchRecategorizeDialog,
)
from file_search_app.ui.dialogs.sticky_note_bulk_delete_dialog import StickyNoteBulkDeleteDialog
from file_search_app.ui.dialogs.sticky_note_dialog import StickyNoteDialog
from file_search_app.ui.dialogs.sticky_note_history_dialog import StickyNoteHistoryDialog
from file_search_app.ui.dialogs.sticky_note_trash_dialog import StickyNoteTrashDialog
from file_search_app.ui.styles import bind_wheel_recursive, darken, styled_button

_ALL_TAGS_LABEL = "全部標籤"

# 搜尋框每打一個字就整批砍掉重畫卡片清單會頓（便利貼一多更明顯），改成打完
# 停頓這麼多毫秒才真的重畫；期間再按鍵就把上一個排程取消重排。
_SEARCH_DEBOUNCE_MS = 150
# 語意搜尋每次要把查詢句送去 Ollama 算向量（就算便利貼向量已快取），比純
# 字串比對重，去抖動放長一點，不要每個鍵都打一次本機 API。
_SEMANTIC_DEBOUNCE_MS = 600

# 到期徽章／「只看快到期」排序是「跟現在時間比」算出來的，卡片畫好之後不會
# 自己隨時間翻新。每這麼多毫秒檢查一次：只有真的有便利貼的到期狀態
# （overdue／soon／無）跨過分鐘邊界翻了，才整批重畫，平常不動、不閃。
_DUE_TICK_MS = 60_000


class _Tooltip:
    """滑鼠移到圖示按鈕（➕／◀）上方短暫顯示的文字說明——這兩顆按鈕只有圖示
    沒有文字，不是每個人都看得出「➕」是新增而不是其他動作，補一個 tooltip
    比硬把按鈕改成有文字更省面板寬度。用 overrideredirect 的小 Toplevel 實作，
    是 Tk 沒有內建 tooltip 元件時最通用的做法。"""

    def __init__(self, widget, text, font):
        self._widget = widget
        self._text = text
        self._font = font
        self._tip = None
        widget.bind("<Enter>", self._show, add="+")
        widget.bind("<Leave>", self._hide, add="+")
        widget.bind("<ButtonPress>", self._hide, add="+")

    def _show(self, _event=None):
        if self._tip is not None or not self._widget.winfo_ismapped():
            return
        x = self._widget.winfo_rootx() + self._widget.winfo_width() // 2
        y = self._widget.winfo_rooty() + self._widget.winfo_height() + 4
        self._tip = tk.Toplevel(self._widget)
        self._tip.wm_overrideredirect(True)
        self._tip.wm_geometry(f"+{x}+{y}")
        tk.Label(
            self._tip, text=self._text, bg=STICKY_TOOLTIP_BG, fg=STICKY_TOOLTIP_FG,
            font=self._font, padx=6, pady=3,
        ).pack()

    def _hide(self, _event=None):
        if self._tip is not None:
            self._tip.destroy()
            self._tip = None


def _icon_button(parent, icon, command, bg, active_bg, font):
    """固定正方形容器＋置中圖示的按鈕——不是直接用 styled_button()（那個是
    tk.Button，寬度照文字/emoji 的實際字寬走）。標題列這四顆按鈕的 emoji
    有的帶 variation selector（例如 🗑️ 其實是兩個 code point），字寬跟
    ➕／◀ 這種單一 code point 的差很多，用 Button 原生寬度四顆會大小不一；
    改成固定像素邊長的 Frame，裡面用 Label 的 place() 置中文字，不管 emoji
    本身多寬，容器大小都固定一樣。"""
    frame = tk.Frame(
        parent, bg=bg, width=STICKY_ICON_BUTTON_SIZE, height=STICKY_ICON_BUTTON_SIZE, cursor="hand2",
    )
    frame.pack_propagate(False)
    label = tk.Label(frame, text=icon, bg=bg, fg="#ffffff", font=font, cursor="hand2")
    label.place(relx=0.5, rely=0.5, anchor="center")

    def _invoke(_e=None):
        command()

    def _hover_on(_e=None):
        frame.configure(bg=active_bg)
        label.configure(bg=active_bg)

    def _hover_off(_e=None):
        frame.configure(bg=bg)
        label.configure(bg=bg)

    for widget in (frame, label):
        widget.bind("<Button-1>", _invoke, add="+")
        widget.bind("<Enter>", _hover_on, add="+")
        widget.bind("<Leave>", _hover_off, add="+")
    return frame


class StickyNotePanel:
    def __init__(self, parent, service, ai_description_service, on_open_ai_settings, font_hint, width, on_collapse):
        self._service = service
        self._ai_description = ai_description_service
        self._on_open_ai_settings = on_open_ai_settings
        self._on_collapse = on_collapse
        self._font_hint = font_hint
        self._font_title = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")
        self._font_icon = tkfont.Font(family=FONT_FAMILY, size=13)
        self._toast_after_id = None
        self._refresh_after_id = None
        self._due_tick_id = None
        self._due_snapshot = ()
        # AI 搜尋結果是「暫時覆蓋一般關鍵字搜尋」的狀態，不是永久模式：只要
        # 搜尋框的文字被改過（不等於送出當下那句問題），_refresh() 會自動
        # 判斷失效、退回一般的關鍵字比對，不需要另外一顆「清除 AI 搜尋」按鈕。
        # 便利貼被新增／編輯／刪除時也會一併清掉（見各 _confirm_* 回呼）——那批
        # 編號是對「送出當下那份清單」算的，清單一動就不再對得上。
        self._ai_result_ids = None
        self._ai_query_snapshot = None

        # 語意搜尋（本機 Ollama embedding 依相似度排序）——跟 AI 搜尋一樣是
        # 「暫時覆蓋一般關鍵字搜尋」的狀態：只在搜尋框文字沒被改過的期間有效。
        # 開關開著時，搜尋框每次改動會（去抖動後）在背景重算一次相似度。
        self._semantic = NoteSemanticService(service)
        self._semantic_var = tk.BooleanVar(value=False)
        self._semantic_scores = None  # {note_id: score}；None＝還沒算/已失效
        self._semantic_top = 0.0  # 這批最高的相似度（顯示在計數列）
        self._semantic_snapshot = None  # 算這批分數時搜尋框的內容
        self._semantic_error = None  # Ollama 連不上/模型沒下載時的訊息（顯示在計數列）
        self._semantic_seq = 0  # 丟掉比目前新一輪還舊的背景結果
        self._semantic_after_id = None

        self.frame = tk.Frame(
            parent, bg=COLOR_PREVIEW_BG, width=width,
            highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
        )
        self.frame.pack_propagate(False)

        header = tk.Frame(self.frame, bg=COLOR_PREVIEW_BG)
        header.pack(fill="x", padx=8, pady=(10, 4))
        tk.Label(
            header, text="📌 便利貼", bg=COLOR_PREVIEW_BG, font=self._font_title, anchor="w",
        ).pack(side="left")
        add_btn = _icon_button(header, "➕", self._on_add, BTN_CREATE_BG, BTN_CREATE_ACTIVE, self._font_icon)
        add_btn.pack(side="right")
        _Tooltip(add_btn, "新增便利貼", font_hint)
        collapse_btn = _icon_button(
            header, "◀", lambda: self._on_collapse(), BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, self._font_icon,
        )
        collapse_btn.pack(side="right", padx=(0, 4))
        _Tooltip(collapse_btn, f"收合面板（快捷鍵 {STICKY_TOGGLE_SHORTCUT}）", font_hint)
        bulk_delete_btn = _icon_button(
            # 特別注意：這裡故意只用垃圾桶本體「🗑」（U+1F5D1），不加後面常見的
            # variation selector「️」（U+FE0F）——實測那個看不見的字元會讓
            # Label 的版面寬度多出 23px（52px vs 29px，其他三顆圖示都是 29px），
            # place() 置中的是「整個 Label 的版面框」，框變寬但看得到的圖案還是
            # 一樣大，圖案就會被擠到框的左側、視覺上偏移中心。
            header, "🗑", self._on_bulk_delete, BTN_DANGER_BG, BTN_DANGER_ACTIVE, self._font_icon,
        )
        bulk_delete_btn.pack(side="right", padx=(0, 4))
        _Tooltip(bulk_delete_btn, "批次刪除便利貼", font_hint)
        batch_recat_btn = _icon_button(
            header, "🏷", self._on_batch_recategorize, BTN_EDIT_BG, BTN_EDIT_ACTIVE, self._font_icon,
        )
        batch_recat_btn.pack(side="right", padx=(0, 4))
        _Tooltip(batch_recat_btn, "批次改標籤（勾選便利貼統一改成同一個標籤）", font_hint)
        trash_btn = _icon_button(
            # 跟上面同一個理由，用不帶 variation selector 的裸符號「♻」（U+267B）。
            header, "♻", self._on_trash, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, self._font_icon,
        )
        trash_btn.pack(side="right", padx=(0, 4))
        _Tooltip(trash_btn, "垃圾桶（刪除的便利貼可以在這裡復原）", font_hint)
        history_btn = _icon_button(
            header, "🕘", self._on_history, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, self._font_icon,
        )
        history_btn.pack(side="right", padx=(0, 4))
        _Tooltip(
            history_btn,
            "版本記錄（自動備份；批次操作出錯、內容被覆蓋時整份還原到某個時間點）",
            font_hint,
        )
        export_btn = _icon_button(header, "📤", self._on_export, BTN_IMPORT_BG, BTN_IMPORT_ACTIVE, self._font_icon)
        export_btn.pack(side="right", padx=(0, 4))
        _Tooltip(export_btn, "匯出成 Markdown 文件（目前篩選出的清單）", font_hint)
        import_data_btn = _icon_button(
            header, "📥", self._on_import_json, BTN_CREATE_BG, BTN_CREATE_ACTIVE, self._font_icon,
        )
        import_data_btn.pack(side="right", padx=(0, 4))
        _Tooltip(import_data_btn, "匯入便利貼資料（讀取先前匯出的 JSON，合併進目前清單）", font_hint)
        export_data_btn = _icon_button(
            header, "💾", self._on_export_json, BTN_IMPORT_BG, BTN_IMPORT_ACTIVE, self._font_icon,
        )
        export_data_btn.pack(side="right", padx=(0, 4))
        _Tooltip(export_data_btn, "匯出便利貼資料（JSON，可搬到另一台電腦匯入）", font_hint)
        edit_file_btn = _icon_button(
            header, "📝", self._on_edit_file, BTN_EDIT_BG, BTN_EDIT_ACTIVE, self._font_icon,
        )
        edit_file_btn.pack(side="right", padx=(0, 4))
        _Tooltip(edit_file_btn, "編輯便利貼檔案（原始 JSON，進階用途）", font_hint)

        tk.Label(
            self.frame, text="🖱️ 單擊卡片複製・右鍵編輯/刪除", bg=COLOR_PREVIEW_BG, fg=COLOR_STATUS_FG,
            font=font_hint, anchor="w",
        ).pack(fill="x", padx=8, pady=(0, 8))

        filter_box = tk.Frame(
            self.frame, bg=STICKY_FILTER_BOX_BG,
            highlightbackground=STICKY_FILTER_BOX_BORDER, highlightthickness=1,
        )
        filter_box.pack(fill="x", padx=8, pady=(0, 8))

        search_row = tk.Frame(filter_box, bg=STICKY_FILTER_BOX_BG)
        search_row.pack(fill="x", padx=8, pady=(8, 4))
        tk.Label(search_row, text="🔍", bg=STICKY_FILTER_BOX_BG, font=font_hint).pack(side="left")
        self._search_var = tk.StringVar()
        search_entry = tk.Entry(search_row, textvariable=self._search_var, font=font_hint, relief="flat")
        search_entry.pack(side="left", fill="x", expand=True, padx=(4, 4), ipady=3)
        self._search_var.trace_add("write", lambda *_a: self._on_search_changed())
        self._ai_search_btn = styled_button(
            search_row, "🤖", self._on_ai_search, BTN_AI_BG, BTN_AI_ACTIVE, font_hint,
        )
        self._ai_search_btn.pack(side="left")
        _Tooltip(
            self._ai_search_btn,
            "AI 搜尋——可以問「有哪些跟○○有關的」「○○有幾個」"
            "「目前有哪些分類」，不用打精確關鍵字",
            font_hint,
        )

        semantic_row = tk.Frame(filter_box, bg=STICKY_FILTER_BOX_BG)
        semantic_row.pack(fill="x", padx=8, pady=(0, 4))
        semantic_check = tk.Checkbutton(
            semantic_row, text="🧠 語意搜尋（依意思相近排序，需本機 Ollama）",
            variable=self._semantic_var, command=self._on_toggle_semantic,
            bg=STICKY_FILTER_BOX_BG, fg=STICKY_FILTER_BOX_FG,
            activebackground=STICKY_FILTER_BOX_BG, selectcolor=STICKY_FILTER_BOX_BG, font=font_hint,
        )
        semantic_check.pack(side="left")
        _Tooltip(
            semantic_check,
            "把搜尋框的字和每則便利貼都轉成向量、依相似度排序——"
            "字面對不上但意思相近的也找得到。第一次會花幾秒建立向量，"
            "之後只算查詢句。需要那台電腦有跑 Ollama 且下載了 embedding 模型。",
            font_hint,
        )

        tag_row = tk.Frame(filter_box, bg=STICKY_FILTER_BOX_BG)
        tag_row.pack(fill="x", padx=8, pady=(0, 4))
        tk.Label(tag_row, text="標籤：", bg=STICKY_FILTER_BOX_BG, fg=STICKY_FILTER_BOX_FG, font=font_hint).pack(side="left")
        self._tag_filter_var = tk.StringVar(value=_ALL_TAGS_LABEL)
        self._tag_filter_combo = ttk.Combobox(
            tag_row, textvariable=self._tag_filter_var, state="readonly", font=font_hint,
        )
        self._tag_filter_combo.pack(side="left", fill="x", expand=True, padx=(4, 0))
        self._tag_filter_combo.bind("<<ComboboxSelected>>", lambda _e: self._on_tag_filter_changed())

        due_row = tk.Frame(filter_box, bg=STICKY_FILTER_BOX_BG)
        due_row.pack(fill="x", padx=8, pady=(0, 4))
        self._due_only_var = tk.BooleanVar(value=False)
        tk.Checkbutton(
            due_row, text="⏰ 只看快到期／已逾期（依到期日排序）", variable=self._due_only_var,
            command=self._refresh, bg=STICKY_FILTER_BOX_BG, fg=STICKY_FILTER_BOX_FG,
            activebackground=STICKY_FILTER_BOX_BG, selectcolor=STICKY_FILTER_BOX_BG, font=font_hint,
        ).pack(side="left")

        self._count_var = tk.StringVar(value="")
        tk.Label(
            filter_box, textvariable=self._count_var, bg=STICKY_FILTER_BOX_BG, fg=STICKY_FILTER_BOX_FG,
            font=font_hint, anchor="w",
        ).pack(fill="x", padx=8, pady=(0, 8))

        self._list_outer = tk.Frame(
            self.frame, bg=COLOR_PREVIEW_BG, highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
        )
        self._list_outer.pack(fill="both", expand=True, padx=8, pady=(0, 4))
        self._canvas = tk.Canvas(self._list_outer, bg=COLOR_PREVIEW_BG, highlightthickness=0)
        scroll = ttk.Scrollbar(self._list_outer, orient="vertical", command=self._canvas.yview)
        self._canvas.configure(yscrollcommand=scroll.set)
        self._canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self._inner = tk.Frame(self._canvas, bg=COLOR_PREVIEW_BG)
        self._inner_id = self._canvas.create_window((0, 0), window=self._inner, anchor="nw")
        self._inner.bind("<Configure>", lambda _e: self._canvas.configure(scrollregion=self._canvas.bbox("all")))
        self._canvas.bind("<Configure>", lambda e: self._canvas.itemconfig(self._inner_id, width=e.width))
        self._canvas.bind("<Button-3>", lambda e: self._popup_empty_menu(e))
        self._inner.bind("<Button-3>", lambda e: self._popup_empty_menu(e))

        # 「已複製」提示做成只在有內容時才佔位的小色塊 toast（不是常駐但空白
        # 的文字列），平常收起來不浪費面板高度，複製當下才彈出來再自動收掉。
        self._toast_label = tk.Label(
            self.frame, bg=STICKY_TOAST_BG, fg=STICKY_TOAST_FG, font=font_hint, pady=4,
        )

        self._refresh()
        self._schedule_due_tick()

    def resize(self, width: int) -> None:
        self.frame.configure(width=width)

    # ── 到期狀態隨時間翻新 ───────────────────────────────────────────

    @staticmethod
    def _compute_due_snapshot(notes, soon_hours):
        """有到期日的便利貼目前的到期狀態（id → overdue／soon／""）——tick 時
        拿它跟上次比，一樣就什麼都不做，不同才重畫。`soon_hours` 也算進去，
        所以在 notes-web 改了「快到期」門檻、讓某則便利貼翻頁時同樣會觸發重畫。"""
        return tuple(
            sorted((n.id, due_status(n.due_at, soon_hours=soon_hours)) for n in notes if n.due_at)
        )

    def _schedule_due_tick(self):
        self._due_tick_id = self.frame.after(_DUE_TICK_MS, self._on_due_tick)

    def _on_due_tick(self):
        self._due_tick_id = None
        if not self.frame.winfo_exists():
            return
        try:
            snapshot = self._compute_due_snapshot(
                self._service.list_notes(), self._service.due_soon_hours()
            )
            changed = snapshot != self._due_snapshot
        except Exception:  # noqa: BLE001 — 讀檔失敗不該讓這個背景 tick 把面板弄壞
            changed = False
        if changed:
            self._refresh()  # 會重算並更新 _due_snapshot
        self._schedule_due_tick()

    # ── 清單重繪 ─────────────────────────────────────────────────────

    def _schedule_refresh(self):
        """搜尋框打字用的去抖動入口——把重畫延後 `_SEARCH_DEBOUNCE_MS`，期間
        再進來就取消上一個排程重排。其他觸發點（標籤下拉、新增／編輯／刪除
        之後）要的是立刻反映，直接呼叫 `_refresh()`。"""
        if self._refresh_after_id is not None:
            self.frame.after_cancel(self._refresh_after_id)
        self._refresh_after_id = self.frame.after(_SEARCH_DEBOUNCE_MS, self._refresh)

    # ── 語意搜尋 ─────────────────────────────────────────────────────

    def _on_search_changed(self):
        """搜尋框文字改動的統一入口：一律排一次去抖動重畫；語意開關開著時，
        另外排一次（更長去抖動的）背景相似度重算。"""
        self._schedule_refresh()
        if self._semantic_var.get():
            self._schedule_semantic()

    def _on_tag_filter_changed(self):
        # 語意開著時，換標籤要重算（新標籤範圍外的便利貼原本沒有分數）
        if self._semantic_var.get() and self._search_var.get().strip():
            self._run_semantic()
        else:
            self._refresh()

    def _on_toggle_semantic(self):
        self._semantic_error = None
        if self._semantic_var.get():
            if self._search_var.get().strip():
                self._run_semantic()  # 立刻算一次，不等去抖動
            else:
                self._refresh()
        else:
            # 關掉→丟掉這批分數，退回一般關鍵字搜尋
            self._semantic_scores = None
            self._semantic_snapshot = None
            if self._semantic_after_id is not None:
                self.frame.after_cancel(self._semantic_after_id)
                self._semantic_after_id = None
            self._refresh()

    def _schedule_semantic(self):
        if self._semantic_after_id is not None:
            self.frame.after_cancel(self._semantic_after_id)
        self._semantic_after_id = self.frame.after(_SEMANTIC_DEBOUNCE_MS, self._run_semantic)

    def _run_semantic(self):
        """在背景執行緒算「查詢句 vs 每則便利貼」的 cosine 相似度（便利貼向量
        有快取，通常只需要算查詢句），完成後把分數存起來、重畫清單。Ollama
        連不上／模型沒下載時把訊息記到 _semantic_error，_refresh() 會顯示在
        計數列並退回關鍵字搜尋。"""
        if self._semantic_after_id is not None:
            self.frame.after_cancel(self._semantic_after_id)
            self._semantic_after_id = None
        if not self._semantic_var.get():
            return
        query = self._search_var.get().strip()
        if not query:
            self._semantic_scores = None
            self._semantic_snapshot = None
            self._refresh()
            return

        tag_filter = "" if self._tag_filter_var.get() == _ALL_TAGS_LABEL else self._tag_filter_var.get()
        model = NotesSettingsRepository().load_embed_model()
        self._semantic_seq += 1
        seq = self._semantic_seq
        self._count_var.set("🧠 語意搜尋計算中…")
        result_queue = queue.Queue()

        def _worker():
            try:
                result_queue.put(("done", self._semantic.search(query, tag_filter, model)))
            except Exception as exc:  # noqa: BLE001 — 背景執行緒任何例外都要塞回佇列
                result_queue.put(("error", f"{type(exc).__name__}: {exc}"))

        def _on_message(message):
            if seq != self._semantic_seq:
                return True  # 已經有更新一輪在跑，這批結果過期了
            kind, payload = message
            if kind == "error" or not payload.get("ok"):
                self._semantic_error = (
                    payload if kind == "error" else payload.get("error")
                ) or "語意搜尋暫時無法使用"
                self._semantic_scores = None
                self._semantic_snapshot = query
            else:
                self._semantic_error = None
                self._semantic_scores = {r["id"]: r["score"] for r in payload["results"]}
                self._semantic_top = payload.get("top_score", 0.0)
                self._semantic_snapshot = query
            self._refresh()
            return True

        start_worker(_worker, result_queue)
        poll_queue(self.frame, result_queue, _on_message)

    def _refresh(self):
        # 有排程中的去抖動重畫就先取消，免得等一下又多跑一次一樣的重畫。
        if self._refresh_after_id is not None:
            self.frame.after_cancel(self._refresh_after_id)
            self._refresh_after_id = None

        notes = self._service.list_notes()
        soon_hours = self._service.due_soon_hours()
        self._due_snapshot = self._compute_due_snapshot(notes, soon_hours)
        known_tags = self._service.known_tags(notes)
        values = [_ALL_TAGS_LABEL] + known_tags
        self._tag_filter_combo["values"] = values
        if self._tag_filter_var.get() not in values:
            self._tag_filter_var.set(_ALL_TAGS_LABEL)
        tag_filter = "" if self._tag_filter_var.get() == _ALL_TAGS_LABEL else self._tag_filter_var.get()

        query_text = self._search_var.get()
        # AI 搜尋結果只在「搜尋框文字沒被改過」的期間有效——一旦文字跟送出
        # 當下的問題不一樣了，代表使用者已經在打別的東西，AI 那批結果不再
        # 對應目前的輸入，自動失效退回一般的關鍵字比對，不用另外一顆
        # 「清除 AI 搜尋」按鈕。標籤篩選則是在 AI 結果之上再篩一層，兩者
        # 疊加使用。
        semantic_on = self._semantic_var.get()
        semantic_ready = (
            semantic_on
            and query_text.strip()
            and self._semantic_snapshot == query_text.strip()
            and self._semantic_scores is not None
        )
        ai_mode = False
        semantic_mode = False
        if self._ai_result_ids is not None and query_text == self._ai_query_snapshot:
            # _ai_result_ids 依 AI 回的相關程度排序（見 _on_ai_search）——照那個
            # 順序取，最相關的排在最前面，不退回 list_notes() 的建立時間序。
            by_id = {n.id: n for n in notes}
            shown = [by_id[i] for i in self._ai_result_ids if i in by_id]
            if tag_filter:
                shown = [n for n in shown if n.tag == tag_filter]
            ai_mode = True
        elif semantic_ready:
            # 語意命中：只留跨過相似度門檻的，依分數高到低排。標籤篩選再疊一層。
            scores = self._semantic_scores
            shown = [n for n in notes if n.id in scores]
            if tag_filter:
                shown = [n for n in shown if n.tag == tag_filter]
            shown.sort(key=lambda n: scores.get(n.id, 0.0), reverse=True)
            semantic_mode = True
        else:
            self._ai_result_ids = None
            shown = self._service.search(notes, query_text, tag_filter)

        # 「只看快到期/已逾期」——疊加在其他篩選之上，同時把排序從「最新建立
        # 在上」換成「最早到期在上」，這樣才看得出接下來該優先處理哪幾則；
        # due_at 是 ISO 字串，字典序排序就是時間序，不用另外解析。
        if self._due_only_var.get():
            shown = [n for n in shown if due_status(n.due_at, soon_hours=soon_hours)]
            shown.sort(key=lambda n: n.due_at)

        self._last_shown = shown  # 匯出功能沿用「目前篩選出的清單」，見 _on_export()

        if ai_mode:
            self._count_var.set(f"🤖 AI 搜尋結果：{len(shown)} 則")
        elif semantic_mode:
            pct = round(self._semantic_top * 100)
            if shown:
                self._count_var.set(f"🧠 語意相似：{len(shown)} 則（依相近程度排序，最相關 {pct}%）")
            else:
                self._count_var.set(f"🧠 沒有語意夠接近的便利貼（最高相似 {pct}%）——換個說法或關掉「語意」")
        elif semantic_on and self._semantic_error and query_text.strip():
            self._count_var.set(f"🧠 語意搜尋無法使用：{self._semantic_error}　·　已改用關鍵字比對")
        elif query_text.strip() or tag_filter:
            self._count_var.set(f"符合條件：{len(shown)} / {len(notes)} 則")
        else:
            self._count_var.set(f"共 {len(notes)} 則")
        if self._due_only_var.get():
            self._count_var.set(self._count_var.get() + "　·　只看快到期/已逾期")

        for child in self._inner.winfo_children():
            child.destroy()

        if not shown:
            hint = "尚無符合條件的便利貼。" if notes else "尚無便利貼，點右上角「➕」新增一則。"
            tk.Label(
                self._inner, text=hint, bg=COLOR_PREVIEW_BG, fg=COLOR_STATUS_FG, font=self._font_hint,
                anchor="w", justify="left", wraplength=200,
            ).pack(fill="x", padx=8, pady=10)
        else:
            for note in shown:
                self._build_card(note, soon_hours)

        bind_wheel_recursive(self._inner, lambda e: self._canvas.yview_scroll(int(-e.delta / 120), "units"))

    def _build_card(self, note, soon_hours):
        color = self._service.color_for_tag(note.tag)
        border_color = darken(color, STICKY_CARD_BORDER_DARKEN)
        hover_color = darken(color, STICKY_CARD_HOVER_DARKEN)
        fold_color = darken(color, STICKY_CARD_FOLD_DARKEN)

        card = tk.Frame(
            self._inner, bg=color, cursor="hand2",
            highlightbackground=border_color, highlightthickness=1,
        )
        card.pack(fill="x", padx=4, pady=4)

        # 右上角摺角裝飾：純視覺上模擬便利貼被撕下一小角的樣子，不影響點擊
        # 範圍（三角形本身也綁了跟卡片一樣的單擊/右鍵事件）。
        fold = tk.Canvas(
            card, width=STICKY_CARD_FOLD_SIZE, height=STICKY_CARD_FOLD_SIZE,
            bg=color, highlightthickness=0, cursor="hand2",
        )
        fold.create_polygon(
            0, 0, STICKY_CARD_FOLD_SIZE, 0, STICKY_CARD_FOLD_SIZE, STICKY_CARD_FOLD_SIZE,
            fill=fold_color, outline="",
        )
        fold.place(relx=1.0, x=-STICKY_CARD_FOLD_SIZE, y=0, anchor="nw")

        title_label = tk.Label(
            card, text=note.title, bg=color, fg=STICKY_CARD_TEXT_COLOR, font=self._font_title,
            anchor="w", justify="left", cursor="hand2",
        )
        title_label.pack(fill="x", padx=8, pady=(8, 2))

        labels_to_wrap = [title_label]
        preview = preview_text(note.body)
        if preview:
            body_label = tk.Label(
                card, text=preview, bg=color, fg=STICKY_CARD_TEXT_COLOR, font=self._font_hint,
                anchor="w", justify="left", cursor="hand2",
            )
            body_label.pack(fill="x", padx=8, pady=(0, 4))
            labels_to_wrap.append(body_label)

        # 底部一排：左邊「# 分類」（沒有分類就不放），右邊建立時間。時間因為
        # 「編輯視同重新建立」（見 StickyNoteService.update_note），實際上是
        # 「最後動過的時間」，剛編輯的便利貼會排到最上面。
        status = due_status(note.due_at, soon_hours=soon_hours)
        if status:
            badge_bg = STICKY_DUE_OVERDUE_BG if status == "overdue" else STICKY_DUE_SOON_BG
            badge_fg = STICKY_DUE_OVERDUE_FG if status == "overdue" else STICKY_DUE_SOON_FG
            badge_text = f"{'⏰ 已逾期' if status == 'overdue' else '⏳ 即將到期'}　{format_due_label(note.due_at)}"
            due_badge = tk.Label(
                card, text=badge_text, bg=badge_bg, fg=badge_fg, font=self._font_hint,
                anchor="w", cursor="hand2",
            )
            due_badge.pack(fill="x", padx=8, pady=(0, 4))
            labels_to_wrap.append(due_badge)

        if note.repeat and note.due_at:
            repeat_badge = tk.Label(
                card, text=f"🔁 {REPEAT_LABELS.get(note.repeat, note.repeat)}",
                bg=color, fg=COLOR_STATUS_FG, font=self._font_hint, anchor="w",
            )
            repeat_badge.pack(fill="x", padx=8, pady=(0, 4))
            labels_to_wrap.append(repeat_badge)

        footer = tk.Frame(card, bg=color)
        footer.pack(fill="x", padx=8, pady=(0, 8))
        footer_widgets = [footer]
        if note.tag:
            tag_label = tk.Label(
                footer, text=f"# {note.tag}", bg=color, fg=STICKY_CARD_TEXT_COLOR, font=self._font_hint,
                anchor="w", cursor="hand2",
            )
            tag_label.pack(side="left")
            footer_widgets.append(tag_label)
        time_label = tk.Label(
            footer, text=format_added_at(note.created_at), bg=color, fg=STICKY_CARD_META_COLOR,
            font=self._font_hint, anchor="e", cursor="hand2",
        )
        time_label.pack(side="right")
        footer_widgets.append(time_label)
        # 釘選星號——★＝已釘選（排在清單最上面），☆＝沒釘。點它切換，不會像
        # 點卡片其他地方那樣觸發「複製」（所以刻意不放進下面的 clickable）。
        pin_label = tk.Label(
            footer, text="★" if note.pinned else "☆", bg=color,
            fg=STICKY_CARD_TEXT_COLOR if note.pinned else STICKY_CARD_META_COLOR,
            font=self._font_hint, cursor="hand2",
        )
        pin_label.pack(side="right", padx=(0, 6))

        card.bind(
            "<Configure>",
            lambda e: [lbl.configure(wraplength=max(60, e.width - 16)) for lbl in labels_to_wrap],
        )

        # 滑鼠移到卡片任何一塊子元件上，整張卡片的邊框都要一起變深/變粗，
        # 提示「這張卡片可以點」——邊框顏色跟著卡片自己的色相走，不是固定色。
        def _hover_on(_e=None):
            card.configure(highlightbackground=hover_color, highlightthickness=2)

        def _hover_off(_e=None):
            card.configure(highlightbackground=border_color, highlightthickness=1)

        clickable = [card, fold, title_label] + labels_to_wrap + footer_widgets
        for widget in clickable:
            widget.bind("<Button-1>", lambda _e, n=note: self._copy(n))
            widget.bind("<Button-3>", lambda e, n=note: self._popup_card_menu(e, n))
            widget.bind("<Enter>", _hover_on)
            widget.bind("<Leave>", _hover_off)

        pin_label.bind("<Button-1>", lambda _e, n=note: self._on_toggle_pin(n))
        pin_label.bind("<Button-3>", lambda e, n=note: self._popup_card_menu(e, n))
        pin_label.bind("<Enter>", _hover_on)
        pin_label.bind("<Leave>", _hover_off)

    # ── 互動 ─────────────────────────────────────────────────────────

    def _copy(self, note):
        file_actions.copy_to_clipboard(self.frame, note.body)
        if self._toast_after_id is not None:
            self.frame.after_cancel(self._toast_after_id)
        # toast 帶上便利貼標題，讓使用者知道剛剛複製的是哪一張；標題可能為空
        # （StickyNoteService 允許 title.strip() 後留白），這時退回「(無標題)」，
        # 過長就截斷避免把 toast 撐爆一整列。
        label = (note.title or "").strip() or "(無標題)"
        if len(label) > 20:
            label = label[:20] + "…"
        self._toast_label.configure(text=f"✅ 已複製「{label}」到剪貼簿")
        # side="bottom" 決定「貼齊面板最下緣」；before=self._list_outer 決定
        # 「在版面配置的處理順序上排在 list_outer 前面」——list_outer 是
        # expand=True，如果 toast 排在它後面才處理，會被它先吃光剩餘空間，
        # 不管 toast 自己是不是 side="bottom" 都一樣會被擠成看不見（就是稍早
        # 新增便利貼對話框「按鈕被擠不見」那個成因，這裡换了個地方一樣會發生）。
        self._toast_label.pack(side="bottom", fill="x", padx=8, pady=(0, 8), before=self._list_outer)
        self._toast_after_id = self.frame.after(1500, self._hide_toast)

    def _hide_toast(self):
        self._toast_after_id = None
        self._toast_label.pack_forget()

    def _popup_card_menu(self, event, note):
        menu = tk.Menu(self.frame, tearoff=0, font=self._font_hint)
        menu.add_command(label="📋 複製", command=lambda: self._copy(note))
        if note.repeat and note.due_at:
            menu.add_command(
                label="✅ 這次完成（排下一次、清單重來）",
                command=lambda: self._on_advance_repeat(note),
            )
        menu.add_command(
            label="📌 取消釘選" if note.pinned else "📌 釘選（排到最上面）",
            command=lambda: self._on_toggle_pin(note),
        )
        menu.add_separator()
        menu.add_command(label="✏️ 編輯", command=lambda: self._on_edit(note))
        menu.add_command(label="🗑️ 刪除", command=lambda: self._on_delete(note))
        menu.tk_popup(event.x_root, event.y_root)

    def _on_advance_repeat(self, note):
        """「這次完成」——把重複便利貼的到期日排到下一次、內文 [x] 清回 [ ]。
        不算「編輯」（不更新 created_at），也不讓 AI 搜尋結果失效。"""
        self._service.advance_repeat(note.id)
        self._refresh()

    def _on_toggle_pin(self, note):
        """釘選／取消釘選——只動排序，不算「編輯」（不更新 created_at）。
        AI 搜尋結果不失效：釘選只改順序、不改哪些便利貼符合，_refresh() 會
        在新的 list_notes() 順序上重挑一次。"""
        self._service.set_pin(note.id, not note.pinned)
        self._refresh()

    def _popup_empty_menu(self, event):
        menu = tk.Menu(self.frame, tearoff=0, font=self._font_hint)
        menu.add_command(label="➕ 新增便利貼", command=self._on_add)
        menu.tk_popup(event.x_root, event.y_root)

    def _on_add(self):
        StickyNoteDialog(
            self.frame, self._service.known_tags(), self._confirm_add,
            self._ai_description, self._service,
        )

    def _invalidate_ai_results(self):
        """便利貼清單一有增刪改就丟掉上一輪 AI 搜尋的編號結果——那批編號是對
        「送出當下那份清單」算的，清單一動就對不上了（原本只在搜尋框文字被
        改過時才失效，漏了這條）。"""
        self._ai_result_ids = None
        self._ai_query_snapshot = None
        # 語意分數也一起失效——刪掉的便利貼會自然從結果消失，但新增／改內容
        # 後要重算才準；開關還開著就在背景重跑一次。
        self._semantic_scores = None
        self._semantic_snapshot = None
        if self._semantic_var.get() and self._search_var.get().strip():
            self._schedule_semantic()

    def _confirm_add(self, title, body, tag, due_at, repeat=""):
        self._service.add_note(title, body, tag, due_at, repeat)
        self._invalidate_ai_results()
        self._refresh()

    def _on_edit(self, note):
        StickyNoteDialog(
            self.frame, self._service.known_tags(),
            lambda title, body, tag, due_at, repeat: self._confirm_edit(
                note.id, title, body, tag, due_at, repeat
            ),
            self._ai_description, self._service,
            title="編輯便利貼", confirm_text="儲存",
            initial_title=note.title, initial_body=note.body, initial_tag=note.tag,
            initial_due_at=note.due_at, initial_repeat=note.repeat,
        )

    def _confirm_edit(self, note_id, title, body, tag, due_at, repeat=""):
        if not self._service.update_note(note_id, title, body, tag, due_at, repeat):
            messagebox.showinfo("編輯便利貼", "這則便利貼已經不存在了（可能在其他視窗被刪除），沒有任何變更。")
        self._invalidate_ai_results()
        self._refresh()

    def _on_delete(self, note):
        if not messagebox.askyesno("刪除便利貼", f"確定要刪除「{note.title}」嗎？會先移到垃圾桶，之後還能復原。"):
            return
        self._service.delete_note(note.id)
        self._invalidate_ai_results()
        self._refresh()

    def _on_trash(self):
        StickyNoteTrashDialog(
            self.frame, self._service, self._service.color_for_tag,
            on_change=lambda: (self._invalidate_ai_results(), self._refresh()),
        )

    def _on_history(self):
        StickyNoteHistoryDialog(
            self.frame, self._service,
            on_change=lambda: (self._invalidate_ai_results(), self._refresh()),
        )

    def _on_bulk_delete(self):
        notes = self._service.list_notes()
        if not notes:
            messagebox.showinfo("批次刪除便利貼", "目前沒有任何便利貼。")
            return
        StickyNoteBulkDeleteDialog(
            self.frame, notes, self._service.color_for_tag, self._confirm_bulk_delete,
        )

    def _confirm_bulk_delete(self, note_ids):
        self._service.delete_notes(note_ids)
        self._invalidate_ai_results()
        self._refresh()

    def _on_batch_recategorize(self):
        notes = self._service.list_notes()
        if not notes:
            messagebox.showinfo("批次改分類", "目前沒有任何便利貼。")
            return
        StickyNoteBatchRecategorizeDialog(
            self.frame, notes, self._service.known_tags(notes), self._service.color_for_tag,
            self._confirm_batch_recategorize,
        )

    def _confirm_batch_recategorize(self, note_ids, tag):
        self._service.update_tags(note_ids, tag)
        self._invalidate_ai_results()
        self._refresh()

    def _on_export(self):
        """匯出「目前篩選出的清單」，不是永遠固定匯出全部——先用標籤/關鍵字
        篩出想要的子集合（例如只留某個標籤）再按匯出，就能只匯出那幾筆；
        什麼都不篩就是全部，行為跟畫面上看到的清單一致，不會讓人意外。"""
        notes = self._last_shown
        if not notes:
            messagebox.showinfo("匯出便利貼", "目前沒有符合條件的便利貼可以匯出。")
            return
        path = filedialog.asksaveasfilename(
            parent=self.frame,
            title="匯出便利貼",
            defaultextension=".md",
            initialfile=f"便利貼_{datetime.now():%Y%m%d_%H%M}.md",
            filetypes=[("Markdown", "*.md"), ("純文字", "*.txt"), ("所有檔案", "*.*")],
        )
        if not path:
            return
        content = self._service.export_markdown(notes)
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
        except OSError as exc:
            messagebox.showerror("匯出便利貼", f"寫入檔案失敗：\n{exc}")
            return
        messagebox.showinfo("匯出便利貼", f"已匯出 {len(notes)} 則便利貼到：\n{path}")

    def _on_export_json(self):
        """匯出「全部」便利貼成可攜 JSON——不受目前篩選影響，這是給搬家／
        備份用的，篩選只是畫面上想看的子集合，備份就該是全部。跟 _on_export()
        的差別：那個是 Markdown 給人看，這個是 JSON 給 _on_import_json() 讀
        回去用。"""
        notes = self._service.list_notes()
        if not notes:
            messagebox.showinfo("匯出便利貼資料", "目前沒有任何便利貼可以匯出。")
            return
        path = filedialog.asksaveasfilename(
            parent=self.frame,
            title="匯出便利貼資料",
            defaultextension=".json",
            initialfile=f"便利貼備份_{datetime.now():%Y%m%d_%H%M}.json",
            filetypes=[("JSON", "*.json"), ("所有檔案", "*.*")],
        )
        if not path:
            return
        content = self._service.export_json(notes)
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
        except OSError as exc:
            messagebox.showerror("匯出便利貼資料", f"寫入檔案失敗：\n{exc}")
            return
        messagebox.showinfo("匯出便利貼資料", f"已匯出 {len(notes)} 則便利貼到：\n{path}")

    def _on_import_json(self):
        """匯入之前用 _on_export_json() 匯出的 JSON——依 id 判斷是否已存在，
        已經匯入過的會被略過，不會匯出重複的便利貼（見
        StickyNoteService.import_json()）。"""
        path = filedialog.askopenfilename(
            parent=self.frame,
            title="匯入便利貼資料",
            filetypes=[("JSON", "*.json"), ("所有檔案", "*.*")],
        )
        if not path:
            return
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
        except OSError as exc:
            messagebox.showerror("匯入便利貼資料", f"讀取檔案失敗：\n{exc}")
            return
        try:
            result = self._service.import_json(content)
        except ValueError as exc:
            messagebox.showerror("匯入便利貼資料", f"檔案格式不對：\n{exc}")
            return
        self._invalidate_ai_results()
        self._refresh()
        message = f"已新增 {result['added']} 則便利貼。"
        if result["skipped"]:
            message += f"\n{result['skipped']} 則跟目前清單重複（相同 id），已略過。"
        messagebox.showinfo("匯入便利貼資料", message)

    def _on_edit_file(self):
        """直接打開底層 `.sticky_notes.json` 讓使用者用文字編輯器手動改——
        跟主視窗「編輯索引檔案」同一套做法（優先開 VS Code，找不到退回記事
        本）。這是原始 JSON、不是給人手動維護的表格格式，跟索引 .md 檔不
        一樣，按鈕跟提示文字都有標「進階用途」，設定使用者的預期。開檔案
        當下不會知道使用者改完存檔後有沒有把 JSON 弄壞，等下次面板要
        重新整理（或重啟 app）讀到損毀內容時，Repository 本來就會安靜退回
        空白預設值，不會讓程式壞掉，但改壞的內容就真的救不回來了。"""
        try:
            file_actions.open_in_text_editor(self._service.get_file_path())
        except OSError as exc:
            messagebox.showerror("編輯便利貼檔案", f"開啟失敗：\n{exc}")

    # ── AI 搜尋 ───────────────────────────────────────────────────────

    def _on_ai_search(self):
        """跟「AI 批次說明」共用同一份 AI 設定（同一個 AIDescriptionService），
        不用另外設定一次。搜尋框目前打的文字就是問題本身，不是額外跳對話框
        再問一次——搜尋框已經是這個用途最自然的輸入位置。呼叫本身在背景
        執行緒跑，避免整個面板在等網路回應時卡住。

        這不只是「篩選卡片」的搜尋——使用者實際會問的問題還包括「某分類
        有哪些事項」「有幾個」「目前有哪些分類」這幾種需要統整內容或計數
        才能回答的問題，只篩選卡片沒辦法回答這些，所以除了拿編號篩選清單
        以外，還會跳出一個對話框顯示 AI 用自然語言寫的完整答案。

        用量／花費是使用者完全看不到的東西：便利貼數量一多，每次呼叫送出
        的內容量就跟著變大，使用者不會自己算 token，也不知道自己已經呼叫
        過幾次。這裡做三件事降低這個風險：①送出前先套用目前的標籤篩選
        （呼應畫面上看得到的範圍，不是不管有沒有篩選都送全部）；②不管是
        雲端還是本機 Provider，送出前一律跳出視窗顯示「這次會送幾則、大約
        多少字元、這是第幾次呼叫」，本機 Provider 之前完全沒有這個提示；
        ③真的送出後才把累計次數存檔，取消或被防呆擋下來的都不算數，次數
        才會忠實反映「真的呼叫過幾次」。"""
        query = self._search_var.get().strip()
        if not query:
            messagebox.showinfo("AI 搜尋", "請先在搜尋框輸入想找的內容，可以用一般語句描述，不用打精確關鍵字。")
            return
        all_notes = self._service.list_notes()
        if not all_notes:
            messagebox.showinfo("AI 搜尋", "目前沒有任何便利貼可以搜尋。")
            return
        tag_filter = "" if self._tag_filter_var.get() == _ALL_TAGS_LABEL else self._tag_filter_var.get()
        notes = [n for n in all_notes if not tag_filter or n.tag == tag_filter]
        if not notes:
            messagebox.showinfo("AI 搜尋", "目前的標籤篩選底下沒有任何便利貼，換一個標籤或選「全部標籤」再試一次。")
            return
        ok, reason = self._ai_description.is_configured()
        if not ok:
            messagebox.showwarning("AI 搜尋", f"{reason}，請先設定好 AI 再試一次。")
            self._on_open_ai_settings(None)
            return

        prompt = self._service.build_ai_search_prompt(notes, query)
        size_estimate = self._ai_description.estimate_prompt_size(prompt)
        call_count = self._ai_description.get_call_count()
        scope_note = f"（已套用標籤篩選「{tag_filter}」，未篩選還有 {len(all_notes)} 則）" if tag_filter else ""
        large_batch_hint = (
            "\n\n💡 便利貼數量較多，若不需要搜尋全部，可以先用標籤篩選縮小範圍再送出，減少每次呼叫的內容量。"
            if len(notes) > STICKY_AI_SEARCH_LARGE_NOTE_COUNT else ""
        )
        proceed = ask_ai_confirm(
            # 用整個主視窗（不是 self.frame，那只是便利貼這塊窄面板本身）來
            # 置中——不然這個確認視窗會貼著左側窄面板的範圍置中，偏到畫面
            # 左邊，跟「AI 批次說明」那邊用整個視窗置中的觀感不一致。
            self.frame.winfo_toplevel(),
            self._ai_description.target_confirm_title(),
            f"即將把 {len(notes)} 則便利貼的標題／標籤／內容片段送出分析。{scope_note}\n\n"
            f"{self._ai_description.target_disclosure_lines()}\n\n"
            f"預估大小：{size_estimate}\n"
            f"這是全部 AI 功能（AI 搜尋＋AI 批次說明共用）累計第 {call_count + 1} 次呼叫"
            f"（僅供參考，實際費用/額度以 Provider 帳單為準）。"
            f"{large_batch_hint}",
        )
        if not proceed:
            return

        self._ai_search_btn.config(state="disabled", text="⏳")
        self._count_var.set("🤖 AI 搜尋中…")
        result_queue = queue.Queue()

        def _worker():
            try:
                provider = self._ai_description.build_provider()
                # 記帳的時間點要在 build_provider() 成功「之後」、真的呼叫
                # generate_description() 之前——跟 AI 批次說明（_generate_one()）
                # 同一個時機點，如果 build_provider() 本身就失敗（設定不完整），
                # 代表根本沒有送出任何請求，不該算一次呼叫。
                self._ai_description.record_call()
                response = provider.generate_description(prompt)
                result_queue.put(("done", response))
            except AIProviderError as exc:
                result_queue.put(("error", str(exc)))
            except Exception as exc:  # noqa: BLE001
                # AIProviderError 以外的例外（連線層 timeout、JSON 解析…）也一定
                # 要塞回佇列——poll_queue 的安全網會接住漏掉的，但這裡自己接才
                # 能給出「型別: 訊息」這種對使用者友善一點的字串。
                result_queue.put(("error", f"{type(exc).__name__}: {exc}"))

        def _on_message(message):
            kind, payload = message
            self._ai_search_btn.config(state="normal", text="🤖")
            if kind == "error":
                self._refresh()  # 先把「AI 搜尋中…」的暫時字樣復原成正常的計數文字
                messagebox.showerror("AI 搜尋", f"呼叫 AI 失敗：\n{payload}")
                return True
            answer, matched = self._service.parse_ai_search_response(payload, notes)
            # 保留相關程度排序（matched 已是 AI 回的順序），_refresh 照這個順序取
            self._ai_result_ids = [note.id for note in matched]
            self._ai_query_snapshot = query
            self._refresh()  # 先把卡片清單篩選好，再跳答案視窗，關掉視窗後畫面已經是篩選好的樣子
            # 用可捲動／可複製的視窗，不是 messagebox.showinfo()——answer 可能是
            # 整段內容統整或程式接上去的完整編號標籤清單，原生 messagebox
            # 不能捲動也不能選取，太長還會把視窗撐到超出螢幕。
            show_scrollable_message(self.frame.winfo_toplevel(), "🤖 AI 回答", answer or "（AI 沒有提供文字說明）")
            return True

        start_worker(_worker, result_queue)
        poll_queue(self.frame, result_queue, _on_message)
