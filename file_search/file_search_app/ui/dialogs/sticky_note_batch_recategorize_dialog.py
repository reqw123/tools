"""批次改分類（便利貼）——搜尋＋勾選要換標籤的便利貼，統一改成同一個標籤
（可留空＝清空標籤），確認後只更新標籤欄，標題／內容都不動。跟索引項目的
`BatchRecategorizeDialog` 是同一個功能定位，只是換成便利貼；清單那塊沿用
`StickyNoteBulkDeleteDialog` 的色卡外觀（依標籤配色），不是索引那邊用的
`FilteredChecklist`——便利貼相關的對話框本來就是這一套視覺語言，兩邊清單
元件不共用也沒關係，維持各自既有的風格比硬要共用元件更重要。"""

import tkinter as tk
from tkinter import font as tkfont, messagebox, ttk

from file_search_app.config import (
    BTN_EDIT_ACTIVE, BTN_EDIT_BG, BTN_REFRESH_ACTIVE, BTN_REFRESH_BG,
    BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, COLOR_BG, COLOR_PREVIEW_BG,
    COLOR_PREVIEW_BORDER, COLOR_STATUS_FG, FONT_FAMILY, STICKY_CARD_BORDER_DARKEN,
    STICKY_CARD_META_COLOR, STICKY_CARD_TEXT_COLOR,
)
from file_search_app.models import format_added_at
from file_search_app.services.sticky_note_service import preview_text
from file_search_app.ui.styles import bind_wheel_recursive, darken, styled_button


class StickyNoteBatchRecategorizeDialog(tk.Toplevel):
    def __init__(self, parent, notes, known_tags, color_for_tag, on_confirm):
        """notes: list[StickyNote]。color_for_tag(tag) -> hex 沿用跟卡片一樣的
        配色函式。on_confirm(note_ids, new_tag)：只包含使用者勾選的那些，
        確認後才呼叫。"""
        super().__init__(parent)
        self.title("批次改分類")
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.geometry("480x600")
        self.minsize(360, 420)
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
            text="勾選要改標籤的便利貼，統一改成下面填的標籤（留空＝清空標籤）；"
                 "只會動標籤欄，標題／內容都不變。",
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

        # 「依標籤快速勾選」——最常見的情境是把某個既有標籤底下的一批便利貼
        # 整批改成別的標籤，一個個手動勾選很累；這裡選一個既有標籤、按一下
        # 就把符合的全部勾起來，不用先用搜尋框篩出來再「勾選目前顯示」。
        by_tag_row = tk.Frame(pad, bg=COLOR_BG)
        by_tag_row.pack(fill="x", pady=(0, 4))
        tk.Label(
            by_tag_row, text="依標籤快速勾選：", bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint,
        ).pack(side="left")
        self._by_tag_var = tk.StringVar()
        by_tag_values = ["（無標籤）"] + sorted(t for t in known_tags if t)
        ttk.Combobox(
            by_tag_row, textvariable=self._by_tag_var, values=by_tag_values,
            state="readonly", font=font_hint, width=18,
        ).pack(side="left", padx=(6, 8))
        styled_button(
            by_tag_row, "☑ 全選此標籤", self._check_by_tag, BTN_REFRESH_BG, BTN_REFRESH_ACTIVE, font_hint,
        ).pack(side="left")

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
        self._canvas = canvas = tk.Canvas(list_outer, bg=COLOR_PREVIEW_BG, highlightthickness=0)
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
            meta = f"目前標籤：{note.tag or '（無）'}　·　{format_added_at(note.created_at)}"
            tk.Label(
                text_col, text=meta, bg=color, fg=STICKY_CARD_META_COLOR, font=font_hint, anchor="w",
            ).pack(fill="x")
            haystack = f"{note.title}\n{note.body}\n{note.tag}".lower()
            self._row_records.append((note, var, row, haystack))

        bind_wheel_recursive(inner, lambda e: canvas.yview_scroll(int(-e.delta / 120), "units"))
        self._apply_filter()

        tag_row = tk.Frame(pad, bg=COLOR_BG)
        tag_row.pack(fill="x", pady=(0, 10))
        tk.Label(tag_row, text="改成標籤：", bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_label).pack(side="left")
        self.tag_var = tk.StringVar()
        ttk.Combobox(
            tag_row, textvariable=self.tag_var, values=sorted(known_tags), font=font_label,
        ).pack(side="left", fill="x", expand=True, padx=(8, 0))

        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(fill="x")
        styled_button(btn_row, "取消", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
        self._apply_btn = styled_button(
            btn_row, "🏷️ 套用到勾選項目", self._confirm, BTN_EDIT_BG, BTN_EDIT_ACTIVE, font_label,
        )
        self._apply_btn.pack(side="right", padx=(0, 8))

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

    def _check_by_tag(self):
        picked = self._by_tag_var.get()
        if not picked:
            messagebox.showinfo("批次改分類", "請先選一個標籤。")
            return
        wanted = "" if picked == "（無標籤）" else picked
        # 先清掉搜尋框——不然等一下要捲過去看的那一列如果被目前的搜尋結果
        # 濾掉（pack_forget），會捲到一個看不到任何東西的空位置。
        if self._search_var.get():
            self._search_var.set("")
        first_row = None
        for note, var, row, _haystack in self._row_records:
            if note.tag == wanted:
                var.set(True)
                if first_row is None:
                    first_row = row
        self._update_count()
        if first_row is not None:
            self._scroll_to_row(first_row)

    def _scroll_to_row(self, row):
        """把清單捲到指定那一列的位置——選好標籤按「全選此標籤」後，讓使用者
        不用自己在清單裡滑找，馬上看得到剛剛被勾起來的是哪些。"""
        self.update_idletasks()  # 剛重新 pack 過，要先讓 Tk 算完新的版面位置
        bbox = self._canvas.bbox("all")
        if not bbox:
            return
        total_height = bbox[3] - bbox[1]
        if total_height <= 0:
            return
        fraction = max(0.0, min(1.0, row.winfo_y() / total_height))
        self._canvas.yview_moveto(fraction)

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
        self._apply_btn.config(text=f"🏷️ 套用到勾選項目（{n}）" if n else "🏷️ 套用到勾選項目")

    def _confirm(self):
        checked = [note for note, v, _row, _haystack in self._row_records if v.get()]
        if not checked:
            messagebox.showinfo("批次改分類", "尚未勾選任何項目。")
            return
        tag = self.tag_var.get().strip()
        label = f"「{tag}」" if tag else "（清空標籤）"
        if not messagebox.askyesno(
            "批次改分類", f"確定要把這 {len(checked)} 則便利貼的標籤統一改成{label}嗎？",
        ):
            return
        self._on_confirm([note.id for note in checked], tag)
        self.destroy()
