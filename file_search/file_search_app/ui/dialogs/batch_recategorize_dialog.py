"""批次改分類——搜尋＋勾選要重新分類的項目，統一改成同一個分類（可留空＝
改成未分類），確認後只更新這幾列的分類欄，路徑／說明都不動。填補「單筆編輯
分類」跟「批次刪除」之間的空白：一批舊項目要換分類，不用再一列一列點
「✏️ 編輯所選列」改。

搜尋框、捲動清單、惰性建列、上限提示、全選／全不選都在 FilteredChecklist
（`ui/widgets/filtered_checklist.py`），這裡只加分類輸入框跟確認流程，
結構上跟 BulkDeleteDialog（delete_dialogs.py）刻意保持一致。"""

import tkinter as tk
from tkinter import font as tkfont, messagebox, ttk

from file_search_app.config import (
    BTN_EDIT_ACTIVE, BTN_EDIT_BG, BTN_REFRESH_ACTIVE, BTN_REFRESH_BG,
    BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, COLOR_BG, COLOR_MISSING_FG,
    COLOR_PREVIEW_BG, COLOR_STATUS_FG, FONT_FAMILY,
)
from file_search_app.ui.styles import icon_for, styled_button
from file_search_app.ui.widgets.filtered_checklist import FilteredChecklist

_MAX_VISIBLE_ROWS = 400


class BatchRecategorizeDialog(tk.Toplevel):
    def __init__(self, parent, entries, existing_categories, on_confirm):
        """entries: list[IndexEntry]（目前檢視範圍內的全部資料列，依序號順序）。
        on_confirm(checked_entries, new_category)：確認後呼叫，只包含使用者
        勾選的那些項目。"""
        super().__init__(parent)
        self.title("批次改分類")
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.geometry("640x600")
        self.minsize(480, 400)
        self.resizable(True, True)

        self._on_confirm = on_confirm

        font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        font_hint = tkfont.Font(family=FONT_FAMILY, size=10)
        self._font_name = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=16, pady=14)

        tk.Label(
            pad,
            text="勾選要改分類的項目，統一改成下面填的分類（留空＝改成未分類）；"
                 "只會動索引裡的分類欄，路徑／說明都不變。",
            bg=COLOR_BG, font=font_hint, fg=COLOR_STATUS_FG, justify="left", anchor="w", wraplength=600,
        ).pack(fill="x", pady=(0, 10))

        self._list = FilteredChecklist(
            pad, entries,
            haystack_of=lambda e: (
                f"{e.serial}\n{e.name}\n{e.category}\n{e.description}\n{e.path}\n{e.source_index.name}"
            ),
            build_row=self._build_row,
            on_count_change=self._update_count,
            max_visible=_MAX_VISIBLE_ROWS,
            overflow_hint="請用搜尋縮小範圍再操作",
            check_visible_colors=(BTN_REFRESH_BG, BTN_REFRESH_ACTIVE),
            wraplength=560,
        )
        self._list.pack(fill="both", expand=True)
        self._list.focus_search()

        cat_row = tk.Frame(pad, bg=COLOR_BG)
        cat_row.pack(fill="x", pady=(10, 0))
        tk.Label(
            cat_row, text="改成分類：", bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_label,
        ).pack(side="left")
        self.category_var = tk.StringVar()
        ttk.Combobox(
            cat_row, textvariable=self.category_var, values=sorted(existing_categories), font=font_label,
        ).pack(side="left", fill="x", expand=True, padx=(8, 0))

        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(fill="x", pady=(10, 0))
        styled_button(btn_row, "取消", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
        self._apply_btn = styled_button(
            btn_row, "🏷️ 套用到勾選項目", self._confirm, BTN_EDIT_BG, BTN_EDIT_ACTIVE, font_label,
        )
        self._apply_btn.pack(side="right", padx=(0, 8))

    def _build_row(self, row, entry, _var):
        tk.Label(
            row, text=f"{entry.serial}.  {icon_for(entry.path)} {entry.name}", bg=COLOR_PREVIEW_BG,
            font=self._font_name, anchor="w", justify="left",
        ).pack(side="left", fill="x", expand=True, padx=(4, 0), pady=(4, 2))
        meta = f"目前分類：{entry.category or '（未分類）'}"
        tk.Label(
            row, text=meta, bg=COLOR_PREVIEW_BG, fg=COLOR_MISSING_FG if not entry.category else COLOR_STATUS_FG,
            font=tkfont.Font(family=FONT_FAMILY, size=10), anchor="w",
        ).pack(side="left", padx=(0, 8), pady=(4, 2))

    def _update_count(self, n):
        self._apply_btn.config(text=f"🏷️ 套用到勾選項目（{n}）" if n else "🏷️ 套用到勾選項目")

    def _confirm(self):
        checked = self._list.selected_items()
        if not checked:
            messagebox.showinfo("批次改分類", "尚未勾選任何項目。")
            return
        category = self.category_var.get().strip()
        label = f"「{category}」" if category else "未分類"
        if not messagebox.askyesno(
            "批次改分類", f"確定要把這 {len(checked)} 筆的分類統一改成{label}嗎？",
        ):
            return
        self._on_confirm(checked, category)
        self.destroy()
