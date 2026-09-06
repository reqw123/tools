"""批次刪除——搜尋＋勾選要從索引刪除哪些項目——列出目前檢視範圍內的全部
資料列，預設全部不勾選（避免手滑整批刪光），勾選的是「要刪除」的項目，
確認後只會刪除索引裡的這幾列紀錄，不會動到實際檔案本身。

搜尋框、捲動清單、惰性建列、上限提示、全選／全不選都在 FilteredChecklist
（`ui/widgets/filtered_checklist.py`），這裡只加「只看路徑遺失」這個額外篩選
維度、紅色狀態橫幅、跟確認流程。"""

import tkinter as tk
from tkinter import font as tkfont, messagebox

from file_search_app.config import (
    BTN_DANGER_ACTIVE, BTN_DANGER_BG, BTN_REFRESH_ACTIVE, BTN_REFRESH_BG,
    BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, BTN_WARN_ACTIVE, BTN_WARN_BG,
    COLOR_BG, COLOR_MISSING_FG, COLOR_PREVIEW_BG, COLOR_PREVIEW_BORDER, COLOR_STATUS_FG,
    FONT_FAMILY, MISSING_ICON,
)
from file_search_app.ui.styles import icon_for, styled_button
from file_search_app.ui.widgets.filtered_checklist import FilteredChecklist

# 測試沿用這個名字檢查上限行為；轉交給 FilteredChecklist 當 max_visible。
_MAX_VISIBLE_ROWS = 400


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
        self._on_confirm = on_confirm
        self._missing_only = False
        # 同一路徑可能在索引中重複出現、`IndexEntry` 又不可雜湊——用 id() 當
        # key 記哪幾筆路徑遺失（dialog 生命週期內 entries 一直被 self._entries
        # 持有，id 穩定），篩選時不用每次重新 stat 檔案系統。
        self._missing_ids = {id(e) for e in entries if not e.exists}

        font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        font_hint = tkfont.Font(family=FONT_FAMILY, size=10)
        self._font_name = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=16, pady=14)

        tk.Label(
            pad,
            text="勾選要從索引刪除的項目（預設全部不勾選，只有勾選的會被刪除；"
                 "只會刪索引裡的這一列紀錄，不會刪除實際檔案）。",
            bg=COLOR_BG, font=font_hint, fg=COLOR_STATUS_FG, justify="left", anchor="w", wraplength=600,
        ).pack(fill="x", pady=(0, 10))

        # 「只看路徑遺失」的狀態橫幅——先建好（不 pack），切換時才 pack 到清單上方。
        self._missing_banner = tk.Frame(
            pad, bg="#fee2e2", highlightbackground=COLOR_MISSING_FG, highlightthickness=1,
        )
        tk.Label(
            self._missing_banner,
            text=f"{MISSING_ICON} 目前只顯示「路徑找不到對應檔案」的項目（其餘項目已暫時隱藏）",
            bg="#fee2e2", fg=COLOR_MISSING_FG, font=font_hint, anchor="w", justify="left",
        ).pack(fill="x", padx=10, pady=6)

        self._list = FilteredChecklist(
            pad, entries,
            haystack_of=lambda e: (
                f"{e.serial}\n{e.name}\n{e.category}\n{e.description}\n{e.path}\n{e.source_index.name}"
            ),
            build_row=self._build_row,
            on_count_change=self._update_count,
            extra_match=lambda e: not self._missing_only or id(e) in self._missing_ids,
            count_text=self._count_text,
            max_visible=_MAX_VISIBLE_ROWS,
            overflow_hint="請用搜尋或「只看路徑遺失」縮小範圍再操作",
            check_visible_colors=(BTN_REFRESH_BG, BTN_REFRESH_ACTIVE),
            wraplength=560,
        )
        self._list.pack(fill="both", expand=True)
        self._list.focus_search()

        # 「只看路徑遺失」按鈕塞進 checklist 的全選列，跟另兩顆並排
        self._missing_btn = styled_button(
            self._list.select_row, "⚠️ 只看路徑遺失", self._toggle_missing_only,
            BTN_WARN_BG, BTN_WARN_ACTIVE, font_hint,
        )
        self._missing_btn.pack(side="right", padx=(0, 8))

        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(fill="x")
        styled_button(btn_row, "取消", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
        self._delete_btn = styled_button(
            btn_row, "🗑️ 刪除勾選項目", self._confirm, BTN_DANGER_BG, BTN_DANGER_ACTIVE, font_label,
        )
        self._delete_btn.pack(side="right", padx=(0, 8))

    def _build_row(self, row, entry, _var):
        missing = id(entry) in self._missing_ids
        icon = MISSING_ICON if missing else icon_for(entry.path)
        tk.Label(
            row, text=f"{entry.serial}.  {icon} {entry.name}", bg=COLOR_PREVIEW_BG,
            fg=COLOR_MISSING_FG if missing else "black",
            font=self._font_name, anchor="w", justify="left",
        ).pack(side="left", fill="x", expand=True, padx=(4, 0), pady=(4, 6))

    def _count_text(self, matched, total, typed):
        if self._missing_only:
            return f"路徑遺失且符合搜尋：{matched} 筆" if typed else f"路徑遺失：{matched} 筆"
        return f"符合搜尋：{matched} / {total} 筆" if typed else f"共 {total} 筆"

    def _toggle_missing_only(self):
        """切換只顯示「路徑找不到對應檔案」的項目。狀態同時反映在三個地方
        （按鈕文字／按鈕按下狀態／清單上方的紅色橫幅＋紅框），避免只改按鈕
        文字讓人分辨不出目前是不是篩選過的清單。"""
        self._missing_only = not self._missing_only
        if self._missing_only:
            self._missing_btn.config(text="✅ 顯示全部項目", relief="sunken")
            self._missing_banner.pack(fill="x", before=self._list, pady=(0, 8))
            self._list.list_border.config(highlightbackground=COLOR_MISSING_FG, highlightthickness=2)
        else:
            self._missing_btn.config(text="⚠️ 只看路徑遺失", relief="flat")
            self._missing_banner.pack_forget()
            self._list.list_border.config(highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1)
        self._list.refilter()

    def _update_count(self, n):
        self._delete_btn.config(text=f"🗑️ 刪除勾選項目（{n}）" if n else "🗑️ 刪除勾選項目")

    def _confirm(self):
        checked = self._list.selected_items()
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
