"""可搜尋、可捲動、惰性建列的勾選清單——「批次刪除索引項目」（BulkDeleteDialog）
與「AI 批次說明」（AISelectDialog）共用的中段區塊。

為什麼要惰性建列：索引可以到幾十萬筆，開視窗當下就把每一列建成 widget 會
卡好幾秒、吃大量記憶體。所以：

- 勾選狀態存在每列自己的 `BooleanVar`（很輕，全部先建好），重建可見列時
  狀態不會掉。
- 列 widget 只依「目前篩選結果」現建，最多 `max_visible` 列，其餘用一行提示
  帶過。整批操作（`check_visible()` / `selected_items()`）走 `records`，不受
  這個畫面上限影響。
- 搜尋框打字去抖動——停頓 `_DEBOUNCE_MS` 才真的重建清單。

呼叫端只要給「怎麼把一個項目變成搜尋字串」跟「怎麼畫一列」，其餘（搜尋框、
全選／全不選、捲動、上限提示、筆數文字）都在這裡。額外的篩選維度（例如批次
刪除的「只看路徑遺失」）用 `extra_match` 疊上去。
"""

import tkinter as tk
from tkinter import font as tkfont, ttk

from file_search_app.config import (
    BTN_IMPORT_ACTIVE, BTN_IMPORT_BG, BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG,
    COLOR_BG, COLOR_MISSING_FG, COLOR_PREVIEW_BG, COLOR_PREVIEW_BORDER, FONT_FAMILY,
)
from file_search_app.ui.styles import bind_wheel_recursive, styled_button

_DEBOUNCE_MS = 180
_DEFAULT_MAX_VISIBLE = 400


class FilteredChecklist(tk.Frame):
    def __init__(
        self, parent, items, *, haystack_of, build_row,
        on_count_change=None, extra_match=None, count_text=None,
        max_visible=_DEFAULT_MAX_VISIBLE, overflow_hint="請用搜尋縮小範圍",
        check_visible_colors=(BTN_IMPORT_BG, BTN_IMPORT_ACTIVE), wraplength=600,
    ):
        """`haystack_of(item) -> str`：拿來比對搜尋字的整段文字（會被轉小寫）。
        `build_row(row_frame, item, var)`：把一列的內容畫進 `row_frame`（已 pack
        好、已含 Checkbutton 綁 `var`）——呼叫端只填名稱／圖示等。
        `on_count_change(n)`：勾選數變動時呼叫（更新確認按鈕文字用）。
        `extra_match(item) -> bool`：搜尋字之外的額外篩選；None＝不額外篩。
        `count_text(matched, total, typed) -> str`：自訂筆數列文字；None＝用預設。
        """
        super().__init__(parent, bg=COLOR_BG)
        self._haystack_of = haystack_of
        self._build_row = build_row
        self._on_count_change = on_count_change
        self._extra_match = extra_match
        self._count_text = count_text or self._default_count_text
        self._max_visible = max_visible
        self._overflow_hint = overflow_hint
        self._after_id = None
        self._row_widgets = []
        self._total = len(items)

        self._font_hint = tkfont.Font(family=FONT_FAMILY, size=10)
        self._font_name = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")
        font_label = tkfont.Font(family=FONT_FAMILY, size=12)

        # (item, BooleanVar, haystack) —— var 全部先建好，很輕
        self.records = [
            (it, tk.BooleanVar(value=False), haystack_of(it).lower()) for it in items
        ]

        search_row = tk.Frame(self, bg=COLOR_BG)
        search_row.pack(fill="x")
        tk.Label(search_row, text="🔍", bg=COLOR_BG, font=font_label).pack(side="left", padx=(0, 6))
        self.search_var = tk.StringVar()
        self._search_entry = tk.Entry(
            search_row, textvariable=self.search_var, font=font_label, relief="flat",
        )
        self._search_entry.pack(side="left", fill="x", expand=True, ipady=4)
        self.search_var.trace_add("write", lambda *_a: self._schedule())

        # 呼叫端可以把額外的篩選鈕 pack 進這個 Frame（例如「只看路徑遺失」）
        self.select_row = tk.Frame(self, bg=COLOR_BG)
        self.select_row.pack(fill="x", pady=(8, 4))
        self.match_var = tk.StringVar()
        tk.Label(
            self.select_row, textvariable=self.match_var, bg=COLOR_BG,
            fg="#5d7285", font=self._font_hint,
        ).pack(side="left")
        styled_button(
            self.select_row, "全部取消勾選", self.uncheck_all,
            BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, self._font_hint,
        ).pack(side="right")
        styled_button(
            self.select_row, "勾選目前顯示", self.check_visible,
            check_visible_colors[0], check_visible_colors[1], self._font_hint,
        ).pack(side="right", padx=(0, 8))

        # 呼叫端可以重上色這個外框（例如批次刪除的「只看路徑遺失」模式轉紅框）
        self.list_border = tk.Frame(
            self, bg=COLOR_PREVIEW_BG,
            highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
        )
        self.list_border.pack(fill="both", expand=True, pady=(4, 10))
        self._canvas = canvas = tk.Canvas(self.list_border, bg=COLOR_PREVIEW_BG, highlightthickness=0)
        scroll = ttk.Scrollbar(self.list_border, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=scroll.set)
        canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self._rows_frame = tk.Frame(canvas, bg=COLOR_PREVIEW_BG)
        inner_id = canvas.create_window((0, 0), window=self._rows_frame, anchor="nw")
        self._rows_frame.bind(
            "<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")),
        )
        canvas.bind("<Configure>", lambda e: canvas.itemconfig(inner_id, width=e.width))
        self._wheel_handler = lambda e: canvas.yview_scroll(int(-e.delta / 120), "units")
        canvas.bind("<MouseWheel>", self._wheel_handler)

        self.overflow_label = tk.Label(
            self._rows_frame, bg=COLOR_PREVIEW_BG, fg=COLOR_MISSING_FG, font=self._font_hint,
            anchor="w", justify="left", wraplength=wraplength,
        )
        self.refilter()

    # ── 對外 ─────────────────────────────────────────────────────────

    def focus_search(self):
        self._search_entry.focus_set()

    def selected_items(self):
        return [it for it, var, _h in self.records if var.get()]

    def selected_count(self):
        return sum(1 for _it, var, _h in self.records if var.get())

    def check_visible(self):
        """把目前篩選結果全部勾起來——含畫面上限之外、沒實際畫出來的符合列。"""
        typed = self.search_var.get().strip().lower()
        for it, var, haystack in self.records:
            if self._matches(it, haystack, typed):
                var.set(True)
        self._notify_count()

    def uncheck_all(self):
        for _it, var, _h in self.records:
            var.set(False)
        self._notify_count()

    def refilter(self):
        """立即依目前搜尋字 + extra_match 重建可見列。呼叫端改了 extra_match
        的相依狀態（例如切換「只看路徑遺失」）後要自己呼叫這個。"""
        if self._after_id is not None:
            self.after_cancel(self._after_id)
            self._after_id = None
        typed = self.search_var.get().strip().lower()

        self.overflow_label.pack_forget()
        for row in self._row_widgets:
            row.destroy()
        self._row_widgets = []

        matched = 0
        for it, var, haystack in self.records:
            if not self._matches(it, haystack, typed):
                continue
            matched += 1
            if matched <= self._max_visible:
                self._make_row(it, var)

        if matched > self._max_visible:
            self.overflow_label.configure(
                text=f"⚠️ 符合的共 {matched} 筆，畫面只列出前 {self._max_visible} 筆——"
                     f"{self._overflow_hint}（「勾選目前顯示」仍會勾選全部符合的筆數）。"
            )
            self.overflow_label.pack(fill="x", padx=6, pady=6)
        self._canvas.yview_moveto(0.0)
        self.match_var.set(self._count_text(matched, self._total, bool(typed)))

    # 相容舊呼叫名
    row_widgets = property(lambda self: self._row_widgets)

    # ── 內部 ─────────────────────────────────────────────────────────

    def _schedule(self):
        if self._after_id is not None:
            self.after_cancel(self._after_id)
        self._after_id = self.after(_DEBOUNCE_MS, self.refilter)

    def _matches(self, item, haystack, typed):
        if typed and typed not in haystack:
            return False
        if self._extra_match is not None and not self._extra_match(item):
            return False
        return True

    def _make_row(self, item, var):
        row = tk.Frame(self._rows_frame, bg=COLOR_PREVIEW_BG)
        row.pack(fill="x", pady=1, padx=2)
        tk.Checkbutton(
            row, variable=var, bg=COLOR_PREVIEW_BG, activebackground=COLOR_PREVIEW_BG,
            command=self._notify_count,
        ).pack(side="left", anchor="n")
        self._build_row(row, item, var)
        bind_wheel_recursive(row, self._wheel_handler)
        self._row_widgets.append(row)

    def _notify_count(self):
        if self._on_count_change is not None:
            self._on_count_change(self.selected_count())

    @staticmethod
    def _default_count_text(matched, total, typed):
        return f"符合搜尋：{matched} / {total} 筆" if typed else f"共 {total} 筆"
