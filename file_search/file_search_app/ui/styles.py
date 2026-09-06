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


def darken(hex_color: str, factor: float) -> str:
    """把顏色往黑色混合 factor 比例（0~1，越大越深）——跟 lighten() 對稱但反向，
    便利貼卡片的邊框／滑鼠移過去的強調色需要比卡片底色本身深一階才有層次，
    而且要跟著卡片底色的色相走（不是固定灰色），這裡直接算就好。"""
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    r = int(r * (1 - factor))
    g = int(g * (1 - factor))
    b = int(b * (1 - factor))
    return f"#{r:02x}{g:02x}{b:02x}"


def make_modal(parent, title, *, bg, size=None, minsize=None, resizable=True):
    """自刻 modal 對話框共用的 Toplevel 骨架——`transient` + `grab_set` + 標題
    + 底色 + （選填）大小／最小大小。回傳建好的 Toplevel，呼叫端往裡面塞
    內容，最後用 `run_modal()` 收尾。"""
    dlg = tk.Toplevel(parent)
    dlg.title(title)
    dlg.configure(bg=bg)
    dlg.transient(parent)
    dlg.grab_set()
    dlg.resizable(resizable, resizable)
    if size:
        dlg.geometry(f"{size[0]}x{size[1]}")
    if minsize:
        dlg.minsize(*minsize)
    return dlg


def run_modal(dlg, parent) -> None:
    """置中在 parent 上、阻塞到 dlg 關閉——`make_modal()` 的收尾。"""
    dlg.update_idletasks()
    center_over_parent(dlg, parent)
    parent.wait_window(dlg)


def center_over_parent(dlg, parent) -> None:
    """把 `dlg` 盡量擺在 `parent` 視窗的正中央（不是螢幕正中央）——所有自刻
    Toplevel 對話框共用的收尾動作。呼叫前 `dlg` 要先 `update_idletasks()`
    好，否則 `winfo_width()` 量到的還是 1x1。量不到 parent 幾何資訊（極少數
    情況）就靜靜用系統預設位置，不影響功能。"""
    try:
        x = parent.winfo_rootx() + max(0, (parent.winfo_width() - dlg.winfo_width()) // 2)
        y = parent.winfo_rooty() + max(0, (parent.winfo_height() - dlg.winfo_height()) // 2)
        dlg.geometry(f"+{x}+{y}")
    except tk.TclError:
        pass


def bind_wheel_recursive(widget, handler):
    """把滑鼠滾輪事件遞迴綁到 widget 跟它所有子孫元件上——Tk 的 MouseWheel 事件
    只會送給滑鼠指標正下方那一個元件，不會自動往上冒泡，所以清單裡每一列（含
    裡面的 Checkbutton／Label）都要各自綁一次，滾輪才會在整個清單範圍內都有效，
    不是只有滑到 Canvas 的空白處才有用。"""
    widget.bind("<MouseWheel>", handler)
    for child in widget.winfo_children():
        bind_wheel_recursive(child, handler)
