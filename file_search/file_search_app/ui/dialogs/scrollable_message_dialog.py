"""可捲動、可選取複製的訊息視窗——取代 messagebox.showinfo() 用來顯示可能
很長的內容（例如便利貼「AI 回答」：整段內容統整、程式接上去的完整編號標籤
清單）。

messagebox.showinfo() 在 Windows 上是系統原生 MessageBox，內容不能捲動、
不能選取，文字一長就把視窗撐到超出螢幕、按不到按鈕。這裡用一般的
tk.Toplevel + 唯讀 Text + 捲軸自己刻，字體比照這支程式其他對話框，並且
多一顆「複製」把整段內容丟到剪貼簿。用法是同步阻塞（跟 showinfo 一樣），
沒有回傳值。"""

import tkinter as tk
from tkinter import font as tkfont

from file_search_app.config import (
    BTN_PRIMARY_ACTIVE, BTN_PRIMARY_BG, BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG,
    COLOR_BG, COLOR_HEADER_BG, FONT_FAMILY,
)
from file_search_app.platform import file_actions
from file_search_app.ui.styles import make_modal, run_modal, styled_button

_MESSAGE_FONT_SIZE = 13
_BUTTON_FONT_SIZE = 12


def show_scrollable_message(parent, title: str, message: str) -> None:
    dlg = make_modal(parent, title, bg=COLOR_BG, size=(520, 460), minsize=(360, 260))

    font_title = tkfont.Font(family=FONT_FAMILY, size=_MESSAGE_FONT_SIZE, weight="bold")
    font_msg = tkfont.Font(family=FONT_FAMILY, size=_MESSAGE_FONT_SIZE)
    font_btn = tkfont.Font(family=FONT_FAMILY, size=_BUTTON_FONT_SIZE)

    pad = tk.Frame(dlg, bg=COLOR_BG)
    pad.pack(fill="both", expand=True, padx=18, pady=16)

    # 按鈕列先用 side="bottom" 釘住、保留高度，內容框再 expand 填滿剩下的
    # 空間——不然 Text 想要的高度會把按鈕列擠到看不見（跟新增便利貼對話框
    # 踩過的同一個 pack 空間分配問題）。
    btn_row = tk.Frame(pad, bg=COLOR_BG)
    btn_row.pack(side="bottom", fill="x", pady=(12, 0))

    tk.Label(
        pad, text=title, bg=COLOR_BG, fg=COLOR_HEADER_BG, font=font_title,
        anchor="w", justify="left", wraplength=470,
    ).pack(side="top", fill="x", pady=(0, 8))

    text_frame = tk.Frame(pad, highlightbackground=COLOR_HEADER_BG, highlightthickness=1)
    text_frame.pack(side="top", fill="both", expand=True)
    text = tk.Text(text_frame, font=font_msg, wrap="word", relief="flat", padx=8, pady=8)
    scroll = tk.Scrollbar(text_frame, orient="vertical", command=text.yview)
    text.configure(yscrollcommand=scroll.set)
    text.pack(side="left", fill="both", expand=True)
    scroll.pack(side="right", fill="y")
    text.insert("1.0", message)
    text.configure(state="disabled")  # 唯讀但仍可選取／複製

    def _close():
        dlg.destroy()

    def _copy():
        file_actions.copy_to_clipboard(dlg, message)

    styled_button(btn_row, "關閉", _close, BTN_PRIMARY_BG, BTN_PRIMARY_ACTIVE, font_btn).pack(side="right")
    styled_button(
        btn_row, "📋 複製全部", _copy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_btn,
    ).pack(side="right", padx=(0, 8))

    dlg.protocol("WM_DELETE_WINDOW", _close)
    dlg.bind("<Escape>", lambda _e: _close())

    run_modal(dlg, parent)
