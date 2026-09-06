"""批次刪除便利貼——列出全部便利貼勾選要刪除的，預設全部不勾選（避免手滑
整批刪光，跟索引項目的批次刪除同一個規矩），搭配搜尋方便便利貼數量一多時
快速篩出要刪的那幾則。卡片沿用跟面板一樣依標籤配色，維持同一套視覺語言。"""

import tkinter as tk
from tkinter import font as tkfont, messagebox, ttk

from file_search_app.config import (
    BTN_REFRESH_ACTIVE, BTN_REFRESH_BG, BTN_DANGER_ACTIVE, BTN_DANGER_BG,
    BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, COLOR_BG, COLOR_PREVIEW_BG,
    COLOR_PREVIEW_BORDER, COLOR_STATUS_FG, FONT_FAMILY, STICKY_CARD_BORDER_DARKEN,
    STICKY_CARD_META_COLOR, STICKY_CARD_TEXT_COLOR,
)
from file_search_app.models import format_added_at
from file_search_app.services.sticky_note_service import preview_text
from file_search_app.ui.styles import bind_wheel_recursive, darken, styled_button


class StickyNoteBulkDeleteDialog(tk.Toplevel):
    def __init__(self, parent, notes, color_for_tag, on_confirm):
        """notes: list[StickyNote]。color_for_tag(tag) -> hex 沿用跟卡片一樣的
        配色函式。on_confirm(note_ids)：只包含使用者勾選的那些，確認後才呼叫。"""
        super().__init__(parent)
        self.title("批次刪除便利貼")
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.geometry("480x560")
        self.minsize(360, 400)
        self.resizable(True, True)

        self._on_confirm = on_confirm
        self._row_records = []  # [(note, var, row, haystack), ...]

        font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        font_hint = tkfont.Font(family=FONT_FAMILY, size=10)
        font_name = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=16, pady=14)

        tk.Label(
            pad,
            text="勾選要刪除的便利貼（預設全部不勾選，只有勾選的會被刪除；此動作無法復原）。",
            bg=COLOR_BG, font=font_hint, fg=COLOR_STATUS_FG, justify="left", anchor="w", wraplength=440,
        ).pack(fill="x", pady=(0, 10))

        search_row = tk.Frame(pad, bg=COLOR_BG)
        search_row.pack(fill="x")
        tk.Label(search_row, text="🔍", bg=COLOR_BG, font=font_label).pack(side="left", padx=(0, 6))
        self._search_var = tk.StringVar()
        search_entry = tk.Entry(search_row, textvariable=self._search_var, font=font_label, relief="flat")
        search_entry.pack(side="left", fill="x", expand=True, ipady=4)
        search_entry.focus_set()
        self._search_var.trace_add("write", lambda *_a: self._apply_filter())

        select_row = tk.Frame(pad, bg=COLOR_BG)
        select_row.pack(fill="x", pady=(8, 4))
        self._match_count_var = tk.StringVar()
        tk.Label(
            select_row, textvariable=self._match_count_var, bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint,
        ).pack(side="left")
        styled_button(
            select_row, "全部取消勾選", self._uncheck_all, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_hint,
        ).pack(side="right")
        styled_button(
            select_row, "勾選目前顯示", self._check_visible, BTN_REFRESH_BG, BTN_REFRESH_ACTIVE, font_hint,
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
        inner = tk.Frame(canvas, bg=COLOR_PREVIEW_BG)
        inner_id = canvas.create_window((0, 0), window=inner, anchor="nw")
        inner.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>", lambda e: canvas.itemconfig(inner_id, width=e.width))

        for note in notes:
            var = tk.BooleanVar(value=False)
            color = color_for_tag(note.tag)
            border = darken(color, STICKY_CARD_BORDER_DARKEN)
            row = tk.Frame(inner, bg=color, highlightbackground=border, highlightthickness=1)
            row.pack(fill="x", pady=2, padx=2)
            tk.Checkbutton(
                row, variable=var, bg=color, activebackground=color, command=self._update_count,
            ).pack(side="left", anchor="n", padx=(4, 0), pady=8)
            text_col = tk.Frame(row, bg=color)
            text_col.pack(side="left", fill="x", expand=True, padx=(4, 8), pady=6)
            tk.Label(
                text_col, text=note.title, bg=color, fg=STICKY_CARD_TEXT_COLOR, font=font_name,
                anchor="w", justify="left",
            ).pack(fill="x")
            preview = preview_text(note.body)
            if preview:
                tk.Label(
                    text_col, text=preview, bg=color, fg=STICKY_CARD_TEXT_COLOR, font=font_hint,
                    anchor="w", justify="left",
                ).pack(fill="x")
            meta = format_added_at(note.created_at)
            if note.tag:
                meta = f"# {note.tag}　·　{meta}"
            tk.Label(
                text_col, text=meta, bg=color, fg=STICKY_CARD_META_COLOR, font=font_hint, anchor="w",
            ).pack(fill="x")
            haystack = f"{note.title}\n{note.body}\n{note.tag}".lower()
            self._row_records.append((note, var, row, haystack))

        bind_wheel_recursive(inner, lambda e: canvas.yview_scroll(int(-e.delta / 120), "units"))
        self._apply_filter()

        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(fill="x")
        styled_button(btn_row, "取消", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
        self._delete_btn = styled_button(
            btn_row, "🗑️ 刪除勾選項目", self._confirm, BTN_DANGER_BG, BTN_DANGER_ACTIVE, font_label,
        )
        self._delete_btn.pack(side="right", padx=(0, 8))

    def _apply_filter(self):
        typed = self._search_var.get().strip().lower()
        shown = 0
        for _note, _var, row, _haystack in self._row_records:
            row.pack_forget()
        for _note, _var, row, haystack in self._row_records:
            if not typed or typed in haystack:
                row.pack(fill="x", pady=2, padx=2)
                shown += 1
        note_text = f"符合搜尋：{shown} / {len(self._row_records)} 則" if typed else f"共 {len(self._row_records)} 則"
        self._match_count_var.set(note_text)

    def _check_visible(self):
        typed = self._search_var.get().strip().lower()
        for _note, var, _row, haystack in self._row_records:
            if not typed or typed in haystack:
                var.set(True)
        self._update_count()

    def _uncheck_all(self):
        for _note, var, _row, _haystack in self._row_records:
            var.set(False)
        self._update_count()

    def _update_count(self):
        n = sum(1 for _note, v, _r, _h in self._row_records if v.get())
        self._delete_btn.config(text=f"🗑️ 刪除勾選項目（{n}）" if n else "🗑️ 刪除勾選項目")

    def _confirm(self):
        checked = [note for note, v, _row, _haystack in self._row_records if v.get()]
        if not checked:
            messagebox.showinfo("批次刪除便利貼", "尚未勾選任何項目。")
            return
        if not messagebox.askyesno(
            "批次刪除便利貼", f"確定要刪除這 {len(checked)} 則便利貼嗎？此動作無法復原。",
        ):
            return
        self._on_confirm([note.id for note in checked])
        self.destroy()
