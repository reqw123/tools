"""重複檔案偵測結果——依內容雜湊分組顯示重複的檔案，每組要求使用者主動選
一筆保留（不預設，避免自動選錯）；只處理有選擇的組別，未選組別保持不變
（只刪索引紀錄，不動實際檔案）。開啟此視窗前，呼叫端已經自動重新驗證過
全部索引項目的 SHA-256（DuplicateService.refresh_and_group）。"""

import tkinter as tk
from tkinter import font as tkfont, messagebox

from file_search_app.config import (
    BTN_DANGER_ACTIVE, BTN_DANGER_BG, BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG,
    COLOR_BG, COLOR_MISSING_FG, COLOR_PREVIEW_BG, COLOR_PREVIEW_BORDER, FONT_FAMILY,
)
from file_search_app.ui.styles import bind_wheel_recursive, icon_for, styled_button
from tkinter import ttk


class DuplicateDialog(tk.Toplevel):
    def __init__(self, parent, groups, on_confirm):
        """groups: list[DuplicateGroup]。on_confirm(entries_to_delete: list[IndexEntry])。"""
        super().__init__(parent)
        self.title("重複檔案偵測")
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.geometry("700x640")
        self.minsize(520, 420)
        self.resizable(True, True)

        self._groups = groups
        self._keep_vars = []
        self._on_confirm = on_confirm

        font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        font_hint = tkfont.Font(family=FONT_FAMILY, size=10)
        font_warning = tkfont.Font(family=FONT_FAMILY, size=11, weight="bold")
        font_name = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")

        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(0, weight=1)
        pad = tk.Frame(self, bg=COLOR_BG)
        pad.grid(row=0, column=0, sticky="nsew", padx=16, pady=(14, 6))

        tk.Label(
            pad,
            text=f"找到 {len(groups)} 組內容完全相同的重複檔案。只需處理想刪除的組別："
                 "每組選一筆保留，其餘索引紀錄會被刪除；未選擇的組別保持不變。",
            bg=COLOR_BG, font=font_warning, fg=COLOR_MISSING_FG, anchor="w", justify="left", wraplength=650,
        ).pack(fill="x", pady=(0, 6))

        self._progress_var = tk.StringVar()
        tk.Label(
            pad, textvariable=self._progress_var, bg=COLOR_BG, fg=COLOR_MISSING_FG, font=font_warning, anchor="w",
        ).pack(fill="x", pady=(0, 6))

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

        for gi, group in enumerate(groups):
            keep_var = tk.IntVar(value=-1)  # -1＝這組還沒選；其餘值是群組內唯一位置
            self._keep_vars.append(keep_var)
            keep_var.trace_add("write", lambda *_a: self._update_progress())
            group_frame = tk.Frame(
                inner, bg=COLOR_PREVIEW_BG, highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
            )
            group_frame.pack(fill="x", padx=4, pady=6)
            tk.Label(
                group_frame, text=f"第 {gi + 1} 組（{len(group.entries)} 筆）：", bg=COLOR_PREVIEW_BG,
                font=font_name, anchor="w",
            ).pack(fill="x", padx=6, pady=(6, 2))
            for item_index, entry in enumerate(group.entries):
                row = tk.Frame(group_frame, bg=COLOR_PREVIEW_BG)
                row.pack(fill="x", padx=6, pady=1)
                tk.Radiobutton(
                    row, text="保留", variable=keep_var, value=item_index, bg=COLOR_PREVIEW_BG,
                    activebackground=COLOR_PREVIEW_BG, font=font_hint,
                ).pack(side="left")
                sub = " ｜ ".join(x.strip() for x in (entry.category, entry.description) if x.strip())
                label_text = (
                    f"{icon_for(entry.path)} {entry.name}　［{entry.source_index.name}／第 {entry.row_index + 1} 列］"
                    + (f"　{sub}" if sub else "")
                )
                tk.Label(
                    row, text=label_text, bg=COLOR_PREVIEW_BG, font=font_hint, anchor="w", justify="left",
                ).pack(side="left", fill="x", expand=True)

        bind_wheel_recursive(inner, lambda e: canvas.yview_scroll(int(-e.delta / 120), "units"))

        # 固定底列先建立按鈕，再更新狀態；順序相反會存取尚不存在的按鈕。
        footer = tk.Frame(
            self, bg="#fee2e2", highlightbackground=BTN_DANGER_BG, highlightthickness=2,
        )
        footer.grid(row=1, column=0, sticky="ew", padx=16, pady=(0, 14))
        tk.Label(
            footer, textvariable=self._progress_var, bg="#fee2e2", fg="#991b1b",
            font=font_label,
        ).pack(side="left", padx=12, pady=11)
        styled_button(footer, "取消", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right", padx=(8, 12), pady=8)
        self._delete_btn = styled_button(
            footer, "✅ 確定並刪除其餘索引項目", self._confirm,
            BTN_DANGER_BG, BTN_DANGER_ACTIVE, font_label,
        )
        self._delete_btn.pack(side="right", pady=8)
        self._update_progress()

    def _update_progress(self):
        resolved = sum(1 for v in self._keep_vars if v.get() >= 0)
        total = len(self._keep_vars)
        self._progress_var.set(f"準備處理：{resolved} / {total} 組（未選組別不變）")
        self._delete_btn.config(state="normal")

    def _confirm(self):
        to_delete = []
        for group, keep_var in zip(self._groups, self._keep_vars):
            keep_index = keep_var.get()
            if keep_index < 0:
                continue  # 沒選的組別整組保留，不參與這次刪除
            for item_index, entry in enumerate(group.entries):
                if item_index != keep_index:
                    to_delete.append(entry)
        if not to_delete:
            messagebox.showinfo("重複檔案偵測", "尚未選擇任何要處理的重複組別，沒有刪除任何索引紀錄。")
            return
        if not messagebox.askyesno(
            "重複檔案偵測",
            f"確定要刪除這 {len(to_delete)} 筆重複的索引紀錄嗎？（只刪索引紀錄，不會刪除實際檔案，此動作無法復原）",
        ):
            return
        # 先關閉本視窗，再由呼叫端執行刪除並顯示「已刪除」結果，避免兩層視窗
        # 疊在一起讓使用者誤以為確定按鈕沒有生效。
        self.destroy()
        self._on_confirm(to_delete)
