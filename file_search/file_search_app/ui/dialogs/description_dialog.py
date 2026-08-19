"""批次補齊說明是空的項目——列成清單讓使用者逐筆審核／修改／決定要不要
套用，確認後才交回呼叫端寫入（不是自動直接寫入，因為建議文字不一定真的
適合直接當說明）。

這個對話框不知道 `suggestions` 裡的建議是怎麼來的——人工批次補說明
（`DescriptionService`，純本地文字擷取）跟 AI 批次說明
（`AIDescriptionService`，呼叫 OpenAI／Ollama）兩種流程最後都是把
`[(IndexEntry, suggested_desc), ...]` 交進來共用同一套審核／編輯／套用畫面，
這裡只管審核這件事本身。"""

import tkinter as tk
from tkinter import font as tkfont, messagebox, ttk

from file_search_app.config import (
    BTN_BLUE_ACTIVE, BTN_BLUE_BG, BTN_PRIMARY_ACTIVE, BTN_PRIMARY_BG,
    BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, BTN_TEAL_ACTIVE, BTN_TEAL_BG,
    COLOR_BG, COLOR_HEADER_BG, COLOR_PREVIEW_BG, COLOR_PREVIEW_BORDER, COLOR_STATUS_FG, FONT_FAMILY,
)
from file_search_app.ui.styles import bind_wheel_recursive, icon_for, styled_button


class BatchDescribeDialog(tk.Toplevel):
    def __init__(self, parent, suggestions, on_confirm):
        """suggestions: [(IndexEntry, suggested_desc), ...]。
        on_confirm([(IndexEntry, desc), ...])，只包含使用者勾選套用的項目。"""
        super().__init__(parent)
        self.title("批次補齊說明")
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.geometry("1080x800")
        self.minsize(760, 560)
        self.resizable(True, True)

        self._on_confirm = on_confirm
        self._items = [
            {"entry": entry, "apply": tk.BooleanVar(value=True), "desc": desc}
            for entry, desc in suggestions
        ]
        self._page_size = 8
        self._page = 0
        self._visible_editors = {}  # item index -> Text，只保留目前頁面的少量元件

        font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        font_hint = tkfont.Font(family=FONT_FAMILY, size=10)
        font_name = tkfont.Font(family=FONT_FAMILY, size=11, weight="bold")
        font_path = tkfont.Font(family=FONT_FAMILY, size=9)
        font_section = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")
        # 說明本文預設 16pt，明顯大於一般輔助文字，適合長者閱讀。
        self._desc_font_size = 16
        self._desc_font = tkfont.Font(family=FONT_FAMILY, size=self._desc_font_size)
        self._desc_font_var = tk.StringVar(value=f"說明字體：{self._desc_font_size} pt")

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=16, pady=14)

        tk.Label(
            pad,
            text=f"共 {len(suggestions)} 筆建議說明——"
                 "請逐筆看過／修改，取消勾選的不會套用。",
            bg=COLOR_BG, font=font_hint, fg=COLOR_STATUS_FG, anchor="w", justify="left", wraplength=1020,
        ).pack(fill="x", pady=(0, 10))

        select_row = tk.Frame(pad, bg=COLOR_BG)
        select_row.pack(fill="x", pady=(0, 4))
        tk.Label(
            select_row, textvariable=self._desc_font_var, bg=COLOR_BG,
            fg=COLOR_HEADER_BG, font=font_label,
        ).pack(side="left")
        styled_button(
            select_row, "A−", lambda: self._change_desc_font(-2),
            BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label,
        ).pack(side="left", padx=(8, 4))
        styled_button(
            select_row, "A＋", lambda: self._change_desc_font(2),
            BTN_BLUE_BG, BTN_BLUE_ACTIVE, font_label,
        ).pack(side="left")
        styled_button(
            select_row, "全部取消", self._uncheck_all, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_hint,
        ).pack(side="right")
        styled_button(
            select_row, "全部套用", self._check_all, BTN_TEAL_BG, BTN_TEAL_ACTIVE, font_hint,
        ).pack(side="right", padx=(0, 8))

        list_outer = tk.Frame(
            pad, bg=COLOR_PREVIEW_BG, highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
        )
        list_outer.pack(fill="both", expand=True, pady=(4, 10))
        canvas = tk.Canvas(list_outer, bg=COLOR_PREVIEW_BG, highlightthickness=0)
        scroll = ttk.Scrollbar(list_outer, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=scroll.set)
        canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self._inner = tk.Frame(canvas, bg=COLOR_PREVIEW_BG)
        inner_id = canvas.create_window((0, 0), window=self._inner, anchor="nw")
        self._inner.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>", lambda e: canvas.itemconfig(inner_id, width=e.width))
        self._canvas = canvas
        self._card_fonts = (font_hint, font_name, font_path, font_section)

        page_row = tk.Frame(pad, bg=COLOR_BG)
        page_row.pack(fill="x", pady=(0, 8))
        self._page_var = tk.StringVar()
        tk.Label(page_row, textvariable=self._page_var, bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint).pack(side="left")
        self._next_btn = styled_button(
            page_row, "下一頁 ▶", lambda: self._change_page(1), BTN_BLUE_BG, BTN_BLUE_ACTIVE, font_hint,
        )
        self._next_btn.pack(side="right")
        self._prev_btn = styled_button(
            page_row, "◀ 上一頁", lambda: self._change_page(-1), BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_hint,
        )
        self._prev_btn.pack(side="right", padx=(0, 8))
        self._render_page()

        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(fill="x")
        styled_button(btn_row, "取消", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
        styled_button(
            btn_row, "套用勾選項目", self._confirm, BTN_PRIMARY_BG, BTN_PRIMARY_ACTIVE, font_label,
        ).pack(side="right", padx=(0, 8))

    def _save_visible_edits(self):
        for item_index, editor in self._visible_editors.items():
            self._items[item_index]["desc"] = editor.get("1.0", "end-1c")

    def _change_desc_font(self, delta):
        self._desc_font_size = max(14, min(28, self._desc_font_size + delta))
        self._desc_font.configure(size=self._desc_font_size)
        self._desc_font_var.set(f"說明字體：{self._desc_font_size} pt")

    def _change_page(self, delta):
        self._save_visible_edits()
        page_count = max(1, (len(self._items) + self._page_size - 1) // self._page_size)
        self._page = max(0, min(page_count - 1, self._page + delta))
        self._render_page()

    def _render_page(self):
        """只建立目前頁面的 8 張卡片，避免一次產生數百個 Text/Scrollbar。"""
        for widget in self._inner.winfo_children():
            widget.destroy()
        self._visible_editors = {}
        font_hint, font_name, font_path, font_section = self._card_fonts
        start = self._page * self._page_size
        end = min(len(self._items), start + self._page_size)

        for item_index in range(start, end):
            item = self._items[item_index]
            entry = item["entry"]
            card = tk.Frame(
                self._inner, bg="#ffffff", highlightbackground="#94a3b8", highlightthickness=1,
            )
            card.pack(fill="x", padx=10, pady=8)
            file_block = tk.Frame(card, bg="#1e3a5f")
            file_block.pack(fill="x")
            tk.Checkbutton(
                file_block, variable=item["apply"], text=f"  第 {item_index + 1} 筆　套用此說明",
                bg="#1e3a5f", fg="#ffffff", activebackground="#1e3a5f", activeforeground="#ffffff",
                selectcolor="#2563eb", font=font_section, anchor="w",
            ).pack(fill="x", padx=10, pady=(8, 2))
            tk.Label(
                file_block, text=f"{icon_for(entry.path)}  {entry.name}", bg="#1e3a5f", fg="#ffffff",
                font=font_name, anchor="w",
            ).pack(fill="x", padx=14)
            tk.Label(
                file_block,
                text=f"分類：{entry.category or '未分類'}　｜　來源索引：{entry.source_index.name}\n{entry.path}",
                bg="#1e3a5f", fg="#bfdbfe", font=font_path, anchor="w", justify="left", wraplength=980,
            ).pack(fill="x", padx=14, pady=(3, 10))

            desc_block = tk.Frame(card, bg="#fff7d6")
            desc_block.pack(fill="x")
            tk.Label(
                desc_block, text="📝  對應的文字說明（可直接編輯）", bg="#fff7d6", fg="#854d0e",
                font=font_section, anchor="w",
            ).pack(fill="x", padx=12, pady=(9, 4))
            text_wrap = tk.Frame(desc_block, bg="#fff7d6")
            text_wrap.pack(fill="x", padx=12, pady=(0, 12))
            editor = tk.Text(
                text_wrap, height=7, wrap="word", font=self._desc_font, bg="#ffffff", fg="#17202a",
                relief="solid", bd=1, padx=12, pady=10, undo=True,
                selectbackground="#2563eb", selectforeground="#ffffff",
            )
            editor_scroll = ttk.Scrollbar(text_wrap, orient="vertical", command=editor.yview)
            editor.configure(yscrollcommand=editor_scroll.set)
            editor.pack(side="left", fill="both", expand=True)
            editor_scroll.pack(side="right", fill="y")
            editor.insert("1.0", item["desc"])
            editor.bind(
                "<MouseWheel>",
                lambda e, w=editor: (w.yview_scroll(int(-e.delta / 120), "units"), "break")[1],
            )
            self._visible_editors[item_index] = editor

        bind_wheel_recursive(
            self._inner, lambda e: self._canvas.yview_scroll(int(-e.delta / 120), "units")
        )
        # recursive 綁定後再覆蓋 Text，讓文字框保有自己的滾動。
        for editor in self._visible_editors.values():
            editor.bind(
                "<MouseWheel>",
                lambda e, w=editor: (w.yview_scroll(int(-e.delta / 120), "units"), "break")[1],
            )
        page_count = max(1, (len(self._items) + self._page_size - 1) // self._page_size)
        self._page_var.set(f"第 {self._page + 1} / {page_count} 頁　（每頁最多 {self._page_size} 筆，共 {len(self._items)} 筆）")
        self._prev_btn.config(state="normal" if self._page > 0 else "disabled")
        self._next_btn.config(state="normal" if self._page + 1 < page_count else "disabled")
        self._canvas.yview_moveto(0)

    def _check_all(self):
        for item in self._items:
            item["apply"].set(True)

    def _uncheck_all(self):
        for item in self._items:
            item["apply"].set(False)

    def _confirm(self):
        self._save_visible_edits()
        items = [
            (item["entry"], item["desc"].strip())
            for item in self._items if item["apply"].get()
        ]
        if not items:
            messagebox.showinfo("批次補齊說明", "沒有勾選任何項目。")
            return
        if not messagebox.askyesno("批次補齊說明", f"確定要套用這 {len(items)} 筆說明嗎？"):
            return
        self._on_confirm(items)
        self.destroy()
