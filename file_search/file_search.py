"""檔案快速搜尋 —— 通用文件索引搜尋工具。

跟任何專案都無關的獨立小工具：讀取 indexes/ 資料夾底下手動維護的 .md 索引表格
（路徑 + 分類 + 一句話說明），提供即時關鍵字搜尋（比對檔名／分類／說明／路徑）、
分類篩選、圖片縮圖預覽，找到結果後可以直接開啟／在檔案總管顯示／複製路徑；也
可以把檔案拖曳進視窗直接新增索引列。

索引來源完全手動維護，這支程式本身**不會掃描任何資料夾**——格式規定跟編輯
說明都寫在 indexes/ 底下每份 .md 檔案開頭。

實際程式碼在 file_search_app/ 套件底下（UI、Service、Repository 分層），
這支檔案只是相容啟動入口，維持原本「python file_search.py」的執行方式不變。

執行方式：
    python file_search.py
"""

from file_search_app.app import run

if __name__ == "__main__":
    run()
