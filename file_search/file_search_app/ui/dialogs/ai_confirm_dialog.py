"""AI 呼叫前的用量／費用確認視窗——取代 messagebox.askyesno()。

Windows 上 tkinter.messagebox 實際上是呼叫作業系統原生的 MessageBox API，
字體完全由系統決定，Tk 的 font／option_add 設定套用不到上面，沒辦法比照
這支程式其他對話框把字放大給看不清楚小字的使用者。這裡改用一般的
tk.Toplevel 自己刻訊息＋按鈕，才能真正控制字體大小；用法跟
messagebox.askyesno() 一樣是同步阻塞、回傳 True/False，呼叫端不用改寫成
callback 風格。"""

import tkinter as tk
from tkinter import font as tkfont

from file_search_app.config import (
    BTN_PRIMARY_ACTIVE, BTN_PRIMARY_BG, BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG,
    COLOR_BG, COLOR_HEADER_BG, COLOR_STATUS_FG, FONT_FAMILY,
)
from file_search_app.ui.styles import styled_button

_MESSAGE_FONT_SIZE = 14
_BUTTON_FONT_SIZE = 13


def ask_ai_confirm(parent, title: str, message: str, confirm_text: str = "確定送出") -> bool:
    """跟 messagebox.askyesno(title, message) 用法一樣，多一個 confirm_text
    可以換確認按鈕的文字（預設「確定送出」，比通用的「是」更清楚在確認
    什麼）。字體固定比一般 messagebox 明顯大——AI 呼叫前的用量/費用提示
    屬於「使用者一定要看清楚才能決定」的內容，不該被系統預設的小字忽略。"""
    result = {"value": False}

    dlg = tk.Toplevel(parent)
    dlg.title(title)
    dlg.configure(bg=COLOR_BG)
    dlg.transient(parent)
    dlg.grab_set()
    # 可調整大小（不是 resizable(False, False)）——這裡的 message 是呼叫端
    # 組出來的動態文字（費用/用量提示，長度會隨便利貼或選取檔案數量變動），
    # 固定死大小、又不給捲動的話，萬一某次文字特別長，視窗有可能比螢幕還
    # 高，使用者會被卡住按不到按鈕；至少留可調整大小這個退路。
    dlg.resizable(True, True)

    font_title = tkfont.Font(family=FONT_FAMILY, size=_MESSAGE_FONT_SIZE, weight="bold")
    font_msg = tkfont.Font(family=FONT_FAMILY, size=_MESSAGE_FONT_SIZE)
    font_btn = tkfont.Font(family=FONT_FAMILY, size=_BUTTON_FONT_SIZE)

    pad = tk.Frame(dlg, bg=COLOR_BG)
    pad.pack(fill="both", expand=True, padx=22, pady=18)

    tk.Label(
        pad, text=title, bg=COLOR_BG, fg=COLOR_HEADER_BG, font=font_title,
        anchor="w", justify="left", wraplength=480,
    ).pack(fill="x", pady=(0, 10))

    tk.Label(
        pad, text=message, bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_msg,
        anchor="w", justify="left", wraplength=480,
    ).pack(fill="x", pady=(0, 18))

    btn_row = tk.Frame(pad, bg=COLOR_BG)
    btn_row.pack(fill="x")

    def _confirm():
        result["value"] = True
        dlg.destroy()

    def _cancel():
        result["value"] = False
        dlg.destroy()

    styled_button(btn_row, "取消", _cancel, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_btn).pack(side="right")
    styled_button(
        btn_row, confirm_text, _confirm, BTN_PRIMARY_BG, BTN_PRIMARY_ACTIVE, font_btn,
    ).pack(side="right", padx=(0, 8))
    dlg.protocol("WM_DELETE_WINDOW", _cancel)

    dlg.update_idletasks()
    # 盡量置中在呼叫端視窗上，不是螢幕正中央——跟其他對話框一致的習慣。
    try:
        x = parent.winfo_rootx() + max(0, (parent.winfo_width() - dlg.winfo_width()) // 2)
        y = parent.winfo_rooty() + max(0, (parent.winfo_height() - dlg.winfo_height()) // 2)
        dlg.geometry(f"+{x}+{y}")
    except tk.TclError:
        pass  # 量不到 parent 幾何資訊就用系統預設位置，不影響功能

    parent.wait_window(dlg)
    return result["value"]
