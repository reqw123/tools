"""垃圾桶——「刪除便利貼」現在是先移到這裡而不是直接消失（見
StickyNoteService.delete_note/delete_notes），這個對話框負責復原或永久刪除。
畫面結構刻意跟 StickyNoteBulkDeleteDialog 對齊（搜尋框＋依標籤配色的卡片
清單），只是每一列的操作從「勾選＋整批刪除」換成「逐列復原／永久刪除」，
因為這裡沒有「勾選一堆再一次搬回主清單」這種批次語意需求——垃圾桶本來就是
救火用的，逐筆決定救不救更直覺。"""

import tkinter as tk
from tkinter import font as tkfont, messagebox, ttk

from file_search_app.config import (
    BTN_DANGER_ACTIVE, BTN_DANGER_BG, BTN_IMPORT_ACTIVE, BTN_IMPORT_BG,
    BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, COLOR_BG, COLOR_PREVIEW_BG,
    COLOR_PREVIEW_BORDER, COLOR_STATUS_FG, FONT_FAMILY, STICKY_CARD_BORDER_DARKEN,
    STICKY_CARD_META_COLOR, STICKY_CARD_TEXT_COLOR,
)
from file_search_app.models import format_added_at
from file_search_app.services.sticky_note_service import preview_text
from file_search_app.ui.styles import bind_wheel_recursive, darken, styled_button


class StickyNoteTrashDialog(tk.Toplevel):
    def __init__(self, parent, service, color_for_tag, on_change):
        """service: StickyNoteService（直接呼叫 list_trash/restore_note/
        purge_note/empty_trash，這個對話框比較像獨立小工具，不像其他便利貼
        對話框那樣把寫入動作交回面板做）。on_change()：任何復原/刪除動作
        之後呼叫，讓面板知道要重新整理清單跟標籤下拉選單。"""
        super().__init__(parent)
        self.title("垃圾桶")
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.geometry("480x560")
        self.minsize(360, 400)
        self.resizable(True, True)

        self._service = service
        self._color_for_tag = color_for_tag
        self._on_change = on_change
        self._row_records = []  # [(trashed, row, haystack), ...]

        self._font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        self._font_hint = tkfont.Font(family=FONT_FAMILY, size=10)
        self._font_name = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=16, pady=14)

        tk.Label(
            pad,
            text="被刪除的便利貼會先放在這裡，可以復原或永久刪除。",
            bg=COLOR_BG, font=self._font_hint, fg=COLOR_STATUS_FG, justify="left", anchor="w", wraplength=440,
        ).pack(fill="x", pady=(0, 10))

        search_row = tk.Frame(pad, bg=COLOR_BG)
        search_row.pack(fill="x")
        tk.Label(search_row, text="🔍", bg=COLOR_BG, font=self._font_label).pack(side="left", padx=(0, 6))
        self._search_var = tk.StringVar()
        search_entry = tk.Entry(search_row, textvariable=self._search_var, font=self._font_label, relief="flat")
        search_entry.pack(side="left", fill="x", expand=True, ipady=4)
        search_entry.focus_set()
        self._search_var.trace_add("write", lambda *_a: self._apply_filter())

        self._match_count_var = tk.StringVar()
        tk.Label(
            pad, textvariable=self._match_count_var, bg=COLOR_BG, fg=COLOR_STATUS_FG, font=self._font_hint,
            anchor="w",
        ).pack(fill="x", pady=(8, 4))

        list_outer = tk.Frame(
            pad, bg=COLOR_PREVIEW_BG, highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
        )
        list_outer.pack(fill="both", expand=True, pady=(4, 10))
        self._canvas = tk.Canvas(list_outer, bg=COLOR_PREVIEW_BG, highlightthickness=0)
        scroll = ttk.Scrollbar(list_outer, orient="vertical", command=self._canvas.yview)
        self._canvas.configure(yscrollcommand=scroll.set)
        self._canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self._inner = tk.Frame(self._canvas, bg=COLOR_PREVIEW_BG)
        inner_id = self._canvas.create_window((0, 0), window=self._inner, anchor="nw")
        self._inner.bind("<Configure>", lambda _e: self._canvas.configure(scrollregion=self._canvas.bbox("all")))
        self._canvas.bind("<Configure>", lambda e: self._canvas.itemconfig(inner_id, width=e.width))

        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(fill="x")
        styled_button(btn_row, "關閉", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, self._font_label).pack(
            side="right"
        )
        self._empty_btn = styled_button(
            btn_row, "清空垃圾桶", self._on_empty, BTN_DANGER_BG, BTN_DANGER_ACTIVE, self._font_label,
        )
        self._empty_btn.pack(side="right", padx=(0, 8))

        self._reload()

    def _reload(self):
        """重新從 service 讀垃圾桶內容、整批重建清單——每次復原/刪除/清空
        之後都呼叫這個，永遠顯示磁碟上最新狀態，不用自己手動同步一筆筆的
        增減（垃圾桶項目不多，整批重建的成本可以忽略）。"""
        for widget in self._inner.winfo_children():
            widget.destroy()
        self._row_records = []

        trash = self._service.list_trash()
        for t in trash:
            color = self._color_for_tag(t.tag)
            border = darken(color, STICKY_CARD_BORDER_DARKEN)
            row = tk.Frame(self._inner, bg=color, highlightbackground=border, highlightthickness=1)
            row.pack(fill="x", pady=2, padx=2)

            text_col = tk.Frame(row, bg=color)
            text_col.pack(side="left", fill="x", expand=True, padx=(8, 8), pady=6)
            tk.Label(
                text_col, text=t.title, bg=color, fg=STICKY_CARD_TEXT_COLOR, font=self._font_name,
                anchor="w", justify="left",
            ).pack(fill="x")
            preview = preview_text(t.body)
            if preview:
                tk.Label(
                    text_col, text=preview, bg=color, fg=STICKY_CARD_TEXT_COLOR, font=self._font_hint,
                    anchor="w", justify="left",
                ).pack(fill="x")
            meta = f"刪除於 {format_added_at(t.deleted_at)}"
            if t.tag:
                meta = f"# {t.tag}　·　{meta}"
            tk.Label(
                text_col, text=meta, bg=color, fg=STICKY_CARD_META_COLOR, font=self._font_hint, anchor="w",
            ).pack(fill="x")

            btn_col = tk.Frame(row, bg=color)
            btn_col.pack(side="right", anchor="n", padx=(0, 6), pady=6)
            styled_button(
                btn_col, "復原", lambda note_id=t.id: self._on_restore(note_id),
                BTN_IMPORT_BG, BTN_IMPORT_ACTIVE, self._font_hint,
            ).pack(side="top", pady=(0, 4))
            styled_button(
                btn_col, "永久刪除", lambda note_id=t.id, title=t.title: self._on_purge(note_id, title),
                BTN_DANGER_BG, BTN_DANGER_ACTIVE, self._font_hint,
            ).pack(side="top")

            haystack = f"{t.title}\n{t.body}\n{t.tag}".lower()
            self._row_records.append((t, row, haystack))

        bind_wheel_recursive(self._inner, lambda e: self._canvas.yview_scroll(int(-e.delta / 120), "units"))
        self._empty_btn.config(state="normal" if trash else "disabled")
        self._apply_filter()

    def _apply_filter(self):
        typed = self._search_var.get().strip().lower()
        shown = 0
        for _t, row, _haystack in self._row_records:
            row.pack_forget()
        for _t, row, haystack in self._row_records:
            if not typed or typed in haystack:
                row.pack(fill="x", pady=2, padx=2)
                shown += 1
        text = f"符合搜尋：{shown} / {len(self._row_records)} 則" if typed else f"垃圾桶共 {len(self._row_records)} 則"
        self._match_count_var.set(text)

    def _on_restore(self, note_id):
        self._service.restore_note(note_id)
        self._reload()
        self._on_change()

    def _on_purge(self, note_id, title):
        if not messagebox.askyesno("永久刪除", f"確定要永久刪除「{title}」嗎？這個動作真的沒辦法復原。"):
            return
        self._service.purge_note(note_id)
        self._reload()
        self._on_change()

    def _on_empty(self):
        if not self._row_records:
            return
        if not messagebox.askyesno(
            "清空垃圾桶", f"確定要永久刪除垃圾桶裡全部 {len(self._row_records)} 則便利貼嗎？這個動作真的沒辦法復原。",
        ):
            return
        self._service.empty_trash()
        self._reload()
        self._on_change()
