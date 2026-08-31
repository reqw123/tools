"""新增／編輯一則便利貼的小視窗——標題、內容（多行）、標籤（可留空，Combobox
提供既有標籤自動完成但不限制只能選清單裡的值）。新增跟編輯共用同一個視窗，
差別只在標題／按鈕文字，以及編輯時預先帶入現有值。"""

import tkinter as tk
from tkinter import font as tkfont, ttk

from file_search_app.config import (
    BTN_PRIMARY_ACTIVE, BTN_PRIMARY_BG, BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG,
    COLOR_BG, COLOR_MISSING_FG, COLOR_STATUS_FG, FONT_FAMILY,
)
from file_search_app.ui.styles import styled_button


class StickyNoteDialog(tk.Toplevel):
    def __init__(
        self, parent, known_tags, on_confirm,
        title="新增便利貼", confirm_text="新增",
        initial_title="", initial_body="", initial_tag="",
    ):
        super().__init__(parent)
        self.title(title)
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.geometry("440x480")
        self.minsize(380, 400)

        font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        font_hint = tkfont.Font(family=FONT_FAMILY, size=10)

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=16, pady=14)

        # 按鈕列／錯誤訊息先用 side="bottom" 釘在底部、預先保留好自己的高度，
        # 不管上面內容框想要多高，這兩塊的可見度都不會被擠掉——這正是先前
        # 「新增便利貼看不到確認按鈕」的成因：Text 元件預設高度是 24 行，比
        # 對話框本身還高，之前又是按 top 依序排到最後才放按鈕列，內容框一路
        # 往下擠，按鈕列自然被推到看不見的地方。
        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(side="bottom", fill="x", pady=(10, 0))

        self._error_var = tk.StringVar(value="")
        tk.Label(
            pad, textvariable=self._error_var, bg=COLOR_BG, fg=COLOR_MISSING_FG, font=font_hint, anchor="w",
        ).pack(side="bottom", fill="x")

        tk.Label(
            pad, text=f"📌 {title}", bg=COLOR_BG,
            font=tkfont.Font(family=FONT_FAMILY, size=14, weight="bold"), anchor="w",
        ).pack(fill="x", pady=(0, 2))
        tk.Label(
            pad, text="常用指令、網站、工具等，方便隨手複製使用。",
            bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint, anchor="w",
        ).pack(fill="x", pady=(0, 10))

        tk.Label(pad, text="標題：", bg=COLOR_BG, font=font_label, anchor="w").pack(fill="x")
        self.title_var = tk.StringVar(value=initial_title)
        title_entry = tk.Entry(pad, textvariable=self.title_var, font=font_label)
        title_entry.pack(fill="x", pady=(2, 10), ipady=4)
        title_entry.focus_set()
        title_entry.select_range(0, "end")

        tk.Label(
            pad, text="標籤（可留空；跟既有標籤同名會套用同一個顏色）：",
            bg=COLOR_BG, font=font_label, anchor="w", wraplength=380, justify="left",
        ).pack(fill="x")
        self.tag_var = tk.StringVar(value=initial_tag)
        ttk.Combobox(
            pad, textvariable=self.tag_var, values=sorted(known_tags), font=font_label,
        ).pack(fill="x", pady=(2, 10))

        tk.Label(
            pad, text="內容（可多行，例如一組指令步驟；超過看得到的行數可以捲動）：",
            bg=COLOR_BG, font=font_label, anchor="w", wraplength=380, justify="left",
        ).pack(fill="x")
        body_frame = tk.Frame(pad, highlightbackground=COLOR_STATUS_FG, highlightthickness=1)
        body_frame.pack(fill="both", expand=True, pady=(2, 0))
        self.body_text = tk.Text(body_frame, font=font_label, wrap="word", relief="flat", padx=6, pady=6, height=8)
        body_scroll = ttk.Scrollbar(body_frame, orient="vertical", command=self.body_text.yview)
        self.body_text.configure(yscrollcommand=body_scroll.set)
        self.body_text.pack(side="left", fill="both", expand=True)
        body_scroll.pack(side="right", fill="y")
        if initial_body:
            self.body_text.insert("1.0", initial_body)

        def _confirm():
            title_value = self.title_var.get().strip()
            if not title_value:
                self._error_var.set("標題不能留空。")
                title_entry.focus_set()
                return
            body_value = self.body_text.get("1.0", "end-1c")
            on_confirm(title_value, body_value, self.tag_var.get())
            self.destroy()

        styled_button(btn_row, "取消", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
        styled_button(btn_row, confirm_text, _confirm, BTN_PRIMARY_BG, BTN_PRIMARY_ACTIVE, font_label).pack(
            side="right", padx=(0, 8)
        )
