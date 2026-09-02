"""檔案快速搜尋 —— 通用文件索引搜尋工具。

跟任何專案都無關的獨立小工具：讀取 indexes/ 資料夾底下手動維護的 .md 索引表格
（路徑 + 分類 + 一句話說明），提供即時關鍵字搜尋（  比對檔名／分類／說明／路徑）、
分類篩選、圖片縮圖預覽，找到結果後可以直接開啟／在檔案總管顯示／複製路徑；也
可以把檔案拖曳進視窗直接新增索引列。

索引來源完全手動維護，這支程式本身**不會掃描任何資料夾**——格式規定跟編輯
說明都寫在 indexes/ 底下每份 .md 檔案開頭。

實際程式碼在 file_search_app/ 套件底下（UI、Service、Repository 分層），
這支檔案只是相容啟動入口，維持原本「python file_search.py」的執行方式不變。

執行方式：
    python file_search.py
"""

import sys

from file_search_app.app import run


def _dispatch_worker_if_requested() -> None:
    """PyInstaller 打包版專用：打包後的 .exe 沒辦法用 `[python, worker.py]` 啟動
    子行程（見 file_search_app/worker_launch.py），所以改由 exe 帶
    `--run-worker <name> <args...>` 自我 re-exec 成子行程，在這裡分派進對應
    worker 的 main() 後直接結束、不會開 GUI。

    直接跑原始碼（`python file_search.py`，沒有這個旗標）時這個函式什麼都不做，
    行為跟以前完全一樣。"""
    if len(sys.argv) >= 3 and sys.argv[1] == "--run-worker":
        name = sys.argv[2]
        # 砍掉 `--run-worker <name>`，讓 worker 的 main() 看到的 sys.argv 跟直接
        # 執行該 .py 時一模一樣（argv[0] 之後緊接著它自己的參數）。
        del sys.argv[1:3]
        if name == "transcription":
            from file_search_app.services import _transcription_worker
            sys.exit(_transcription_worker.main())
        if name == "legacy_office":
            from file_search_app.services import _legacy_office_worker
            sys.exit(_legacy_office_worker.main())
        print(f"未知的 worker：{name}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    _dispatch_worker_if_requested()
    run()
 