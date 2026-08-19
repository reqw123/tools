"""開啟檔案、檔案總管、剪貼簿、文字編輯器——單純呼叫作業系統功能，不知道
Tkinter 的存在（複製到剪貼簿例外：Windows 上剪貼簿是透過 Tcl 的剪貼簿指令
存取，Tkinter 沒有獨立於 Widget 之外的剪貼簿 API，所以這裡接受呼叫端傳入
任一個 Tk widget 當存取剪貼簿的手把，本身不持有、不建立任何 Widget）。

失敗一律讓例外往上拋，由 UI 決定要顯示什麼訊息、用什麼字眼——這裡不顯示
messagebox。
"""

import os
import shutil
import subprocess
from pathlib import Path


def open_file(path: str) -> None:
    """用作業系統預設關聯程式開啟，一般文件/圖片/影音都適用。"""
    os.startfile(path)  # 可能丟 OSError，交由呼叫端處理


def reveal_in_explorer(file_path: Path) -> None:
    """優先用 Explorer 的 /select, 開啟並選取這個檔案；如果失敗（例如環境缺
    explorer.exe），退回至少打開它的父資料夾。兩者都失敗時往上拋出第一次
    （Explorer /select,）失敗的例外，保留比較有意義的錯誤訊息。"""
    try:
        # Windows Explorer 對 /select, 的解析很特殊：開關與路徑分成兩個
        # argv 最穩定，subprocess 會自行替含空格／中文的完整路徑加引號。
        subprocess.Popen(["explorer.exe", "/select,", os.path.normpath(str(file_path))])
    except OSError as e:
        try:
            os.startfile(str(file_path.parent))
        except OSError:
            raise e


def open_in_text_editor(path: Path) -> None:
    """優先用 VS Code 開啟，找不到就退回記事本（用完整路徑，不靠 PATH 解析，
    避免某些啟動環境 PATH 不含 System32 導致 FileNotFoundError）。"""
    editor = shutil.which("code")
    fallback = str(Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "notepad.exe")
    subprocess.Popen([editor or fallback, str(path)])


def copy_to_clipboard(widget, text: str) -> None:
    """把文字複製到系統剪貼簿。"""
    widget.clipboard_clear()
    widget.clipboard_append(text)
