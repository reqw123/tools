"""UI 樣式——共用的 Tkinter 外觀小工具，供 main_window／各 widgets／dialogs
共用，避免每個檔案各自重寫一次同樣的按鈕／滾輪綁定邏輯。"""

import tkinter as tk
from pathlib import Path

from file_search_app.config import DEFAULT_ICON, EXT_ICON


def icon_for(path_str: str) -> str:
    """副檔名 → 圖示，純粹方便掃視清單時快速分辨檔案類型，不影響搜尋/開啟邏輯。
    清單、預覽面板與各個對話框（新增／編輯／重複偵測／批次補說明…）都用同一份，
    確保同一個檔案不管在哪個畫面看到的圖示都一致。"""
    return EXT_ICON.get(Path(path_str).suffix.lower(), DEFAULT_ICON)


def styled_button(parent, text, command, bg, active_bg, font, fg="#ffffff"):
    return tk.Button(
        parent, text=text, command=command, bg=bg, fg=fg,
        activebackground=active_bg, activeforeground=fg, relief="flat",
        font=font, padx=12, pady=6, cursor="hand2",
    )


def lighten(hex_color: str, factor: float) -> str:
    """把顏色往白色混合 factor 比例（0~1，越大越淡）——類型按鈕沒選取時用淡版
    底色、選取時用原色，兩種狀態都看得出是哪個類型、又能分辨目前選了哪些。"""
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    r = int(r + (255 - r) * factor)
    g = int(g + (255 - g) * factor)
    b = int(b + (255 - b) * factor)
    return f"#{r:02x}{g:02x}{b:02x}"


def bind_wheel_recursive(widget, handler):
    """把滑鼠滾輪事件遞迴綁到 widget 跟它所有子孫元件上——Tk 的 MouseWheel 事件
    只會送給滑鼠指標正下方那一個元件，不會自動往上冒泡，所以清單裡每一列（含
    裡面的 Checkbutton／Label）都要各自綁一次，滾輪才會在整個清單範圍內都有效，
    不是只有滑到 Canvas 的空白處才有用。"""
    widget.bind("<MouseWheel>", handler)
    for child in widget.winfo_children():
        bind_wheel_recursive(child, handler)
