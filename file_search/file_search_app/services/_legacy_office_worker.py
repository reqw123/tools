"""子行程進入點——用 Office COM 自動化擷取舊版二進位格式（.doc/.ppt/.xls，
微軟 97-2003 那種不是 zip 包 XML 的格式）的文字內容。

刻意獨立成子行程執行，不是直接在主行程或背景執行緒裡呼叫 COM：COM 呼叫
一旦卡在某個彈出視窗（巨集警告、受保護的檢視、格式修復提示……）沒人會去
點，一般的執行緒逾時機制沒辦法安全中斷一個卡在 Win32 呼叫裡的執行緒；
獨立子行程至少可以整個被 `subprocess.run(..., timeout=...)` 強制終止，
不會讓主程式或其他背景工作（更新內容快取、AI 批次說明）跟著卡死。

⚠️ 已知限制：如果真的卡在一個沒人會點的對話框，`terminate()` 只會殺掉這個
Python 子行程本身，COM 啟動的 Office 應用程式（POWERPNT.EXE／WINWORD.EXE／
EXCEL.EXE）不保證是這個子行程的子行程，可能會殘留在背景（工作管理員看得到、
不會有視窗），需要使用者自己關掉——這是 Office COM 自動化本身的限制，不是
好解決的問題，只能靠合理的逾時降低發生機率、盡量讓正常檔案在時間內完成。

用法：python _legacy_office_worker.py <.doc|.ppt|.xls> <檔案完整路徑>
成功：文字內容印到 stdout（UTF-8），結束碼 0。
失敗：結束碼非 0，不印任何內容——呼叫端（PreviewService）只在乎「有沒有
拿到文字」，錯誤細節不重要，這條路徑本來就是「能撐則撐、撐不住就安靜
放棄」的最後防線，退回一般圖示不會讓整支工具跟著掛掉。
"""

import sys


def _extract_ppt(path: str) -> str:
    import win32com.client

    app = win32com.client.DispatchEx("PowerPoint.Application")
    try:
        pres = app.Presentations.Open(path, WithWindow=False)
        try:
            chunks = []
            for slide in pres.Slides:
                for shape in slide.Shapes:
                    if shape.HasTextFrame and shape.TextFrame.HasText:
                        text = shape.TextFrame.TextRange.Text
                        if text and text.strip():
                            chunks.append(text.strip())
            return "\n".join(chunks)
        finally:
            pres.Close()
    finally:
        app.Quit()


def _extract_doc(path: str) -> str:
    import win32com.client

    app = win32com.client.DispatchEx("Word.Application")
    app.Visible = False
    app.DisplayAlerts = False
    try:
        doc = app.Documents.Open(path, ReadOnly=True, AddToRecentFiles=False, ConfirmConversions=False)
        try:
            return doc.Content.Text
        finally:
            doc.Close(False)
    finally:
        app.Quit()


def _extract_xls(path: str) -> str:
    import win32com.client

    app = win32com.client.DispatchEx("Excel.Application")
    app.Visible = False
    app.DisplayAlerts = False
    try:
        wb = app.Workbooks.Open(path, ReadOnly=True, UpdateLinks=False)
        try:
            ws = wb.Worksheets(1)
            values = ws.UsedRange.Value
            rows_out = []
            if values is None:
                pass
            elif isinstance(values, tuple):
                for row in values[:60]:
                    cells = row if isinstance(row, tuple) else (row,)
                    text_cells = [str(c) for c in cells if c is not None and str(c).strip()]
                    if text_cells:
                        rows_out.append(" | ".join(text_cells))
            else:
                rows_out.append(str(values))
            return "\n".join(rows_out)
        finally:
            wb.Close(False)
    finally:
        app.Quit()


_EXTRACTORS = {".ppt": _extract_ppt, ".doc": _extract_doc, ".xls": _extract_xls}


def main() -> int:
    if len(sys.argv) != 3:
        return 2
    ext, path = sys.argv[1].lower(), sys.argv[2]
    extractor = _EXTRACTORS.get(ext)
    if extractor is None:
        return 2

    import pythoncom

    pythoncom.CoInitialize()
    try:
        text = extractor(path)
    except Exception:
        return 1
    finally:
        pythoncom.CoUninitialize()

    if not text or not text.strip():
        return 1
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
