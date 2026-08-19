"""批次刪除——搜尋＋勾選要從索引刪除哪些項目——列出目前檢視範圍內的全部
資料列，預設全部不勾選（避免手滑整批刪光），勾選的是「要刪除」的項目，
確認後只會刪除索引裡的這幾列紀錄，不會動到實際檔案本身。"""

import tkinter as tk
from tkinter import font as tkfont, messagebox, ttk

from file_search_app.config import (
    BTN_CYAN_ACTIVE, BTN_CYAN_BG, BTN_DANGER_ACTIVE, BTN_DANGER_BG,
    BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, COLOR_BG, COLOR_PREVIEW_BG, COLOR_PREVIEW_BORDER,
    COLOR_STATUS_FG, FONT_FAMILY,
)
from file_search_app.ui.styles import bind_wheel_recursive, icon_for, styled_button


class BulkDeleteDialog(tk.Toplevel):
    def __init__(self, parent, entries, on_confirm):
        """entries: list[IndexEntry]（目前檢視範圍內的全部資料列，依序號順序）。"""
        super().__init__(parent)
        self.title("批次刪除索引項目")
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.geometry("640x600")
        self.minsize(480, 400)
        self.resizable(True, True)

        self._entries = entries
        # 不能只用路徑當識別依據：同一路徑可能在一份或多份索引中重複出現，
        # 靠路徑分組刪除會連帶刪掉使用者沒勾選的那幾筆。改成連 IndexEntry
        # 本身一起記錄（内含 row_index），確認時精確傳回使用者實際勾選的那幾筆。
        self._row_records = []   # [(entry, var, row_frame, 搜尋用小寫全文), ...]
        self._on_confirm = on_confirm

        font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        font_hint = tkfont.Font(family=FONT_FAMILY, size=10)
        font_name = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=16, pady=14)

        tk.Label(
            pad,
            text="勾選要從索引刪除的項目（預設全部不勾選，只有勾選的會被刪除；"
                 "只會刪索引裡的這一列紀錄，不會刪除實際檔案）。",
            bg=COLOR_BG, font=font_hint, fg=COLOR_STATUS_FG, justify="left", anchor="w", wraplength=600,
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
            select_row, "勾選目前顯示", self._check_visible, BTN_CYAN_BG, BTN_CYAN_ACTIVE, font_hint,
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

        for entry in entries:
            var = tk.BooleanVar(value=False)
            row = tk.Frame(inner, bg=COLOR_PREVIEW_BG)
            row.pack(fill="x", pady=1, padx=2)
            tk.Checkbutton(
                row, variable=var, bg=COLOR_PREVIEW_BG, activebackground=COLOR_PREVIEW_BG,
                command=self._update_count,
            ).pack(side="left", anchor="n")
            tk.Label(
                row, text=f"{entry.serial}.  {icon_for(entry.path)} {entry.name}", bg=COLOR_PREVIEW_BG,
                font=font_name, anchor="w", justify="left",
            ).pack(side="left", fill="x", expand=True, padx=(4, 0), pady=(4, 6))
            haystack = (
                f"{entry.serial}\n{entry.name}\n{entry.category}\n{entry.description}\n"
                f"{entry.path}\n{entry.source_index.name}"
            ).lower()
            self._row_records.append((entry, var, row, haystack))

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
        # 先全部收起再依原始順序重建可見列，既不留下重複路徑的殘影，也不會在
        # 清除搜尋字時把曾隱藏的列全部插到清單尾端。
        for _entry, _var, row, _haystack in self._row_records:
            row.pack_forget()
        for _entry, _var, row, haystack in self._row_records:
            if not typed or typed in haystack:
                row.pack(fill="x", pady=1, padx=2)
                shown += 1
        note = f"符合搜尋：{shown} / {len(self._entries)} 筆" if typed else f"共 {len(self._entries)} 筆"
        self._match_count_var.set(note)

    def _check_visible(self):
        """把「目前搜尋結果」全部勾起來——不是全部項目，這樣才能先搜尋縮小範圍
        再一次勾選一整批，不用逐筆點。"""
        typed = self._search_var.get().strip().lower()
        for _entry, var, _row, haystack in self._row_records:
            if not typed or typed in haystack:
                var.set(True)
        self._update_count()

    def _uncheck_all(self):
        for _entry, var, _row, _haystack in self._row_records:
            var.set(False)
        self._update_count()

    def _update_count(self):
        n = sum(1 for _e, v, _r, _h in self._row_records if v.get())
        self._delete_btn.config(text=f"🗑️ 刪除勾選項目（{n}）" if n else "🗑️ 刪除勾選項目")

    def _confirm(self):
        checked = [entry for entry, v, _row, _haystack in self._row_records if v.get()]
        if not checked:
            messagebox.showinfo("批次刪除索引項目", "尚未勾選任何項目。")
            return
        if not messagebox.askyesno(
            "批次刪除索引項目",
            f"確定要從索引刪除這 {len(checked)} 筆嗎？（只會刪除索引紀錄，不會刪除實際檔案，此動作無法復原）",
        ):
            return
        self._on_confirm(checked)
        self.destroy()
