# 📑 檔案快速索引

> 這份文件是 `file_search.py` 的其中一份索引來源，**完全手動維護**——程式不會
> 掃描任何資料夾，只讀這份表格（或用「拖曳檔案」「新增檔案...」「匯入資料夾...」
> 功能自動新增列）。
>
> `file_search.py` 支援**多份索引檔案**：`indexes/` 資料夾底下每一個 `.md` 檔
> 都是獨立一份索引集，程式標題列的下拉選單可以切換要搜尋哪一份；要新增一份
> 新的索引集，直接在 `indexes/` 底下新建一個 `.md` 檔、照同樣的表格格式寫即可，
> 不用改程式碼。
>
> **格式規定（跟這一行格式不一樣的列，程式會直接跳過、不會出錯，但那筆資料就搜尋不到）**：
>
> ```
> | `完整路徑\檔名.副檔名` | 分類 | 一句話說明或關鍵字 |
> ```
>
> - 開頭是 `|`，接著檔名用單一反引號 `` ` `` 包住，然後是**分類**欄（自訂文字，
>   例如「論文」「截圖」「教學筆記」——程式會依目前這份索引裡出現過的分類自動
>   組成篩選下拉選單，同一個分類名稱打法要一致，不然會被當成兩種不同分類），
>   最後是**說明**欄
> - 路徑裡有反引號的話沒辦法收錄，實務上檔名幾乎不會用到反引號，不用擔心
> - 路徑建議用**完整絕對路徑**，因為這些檔案通常散落在硬碟各處，不像同一個
>   專案資料夾底下的檔案能用相對路徑
> - 分類欄、說明欄都不能包含 `|` 符號（會被誤判成表格分隔線，文字會被腰斬），
>   要表達「或」的意思請用「／」
> - 分類欄留空（`| \`路徑\` |  | 說明 |`）也可以，篩選下拉選單會把這種歸類成
>   「未分類」
> - 一行只能收錄一個檔案；同一個檔案要多個關鍵字都搜得到，就把關鍵字都寫進說明欄，
>   搜尋是比對說明欄全文，不是只比對第一個詞
> - 用「拖曳檔案」「新增檔案...」「匯入資料夾...」新增的列，會自動照這個格式
>   附加到表格最後一行，不用手動維護對齊；表格裡列的先後順序不影響搜尋結果，
>   純粹是你閱讀這份文件時的順序

| 路徑 | 分類 | 說明 |
|---|---|---|
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0001.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0002.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0003.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0004.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0005.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0006.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0007.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0008.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0009.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0010.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0011.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0012.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0013.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0014.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0015.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0016.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0017.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0018.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0019.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0020.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0021.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0022.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0023.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0024.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0025.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0026.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0027.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0028.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0029.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0030.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0031.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0032.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0033.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0034.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0035.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0036.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0037.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0038.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0039.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0040.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0041.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0042.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0043.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0044.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0045.mp4` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0046.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0047.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0048.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0049.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0050.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0051.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0052.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0053.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0054.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0055.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0056.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0057.mp3` |  |  |
| `C:\Users\homec\OneDrive\圖片\bgm\新增資料夾\0058.mp3` |  |  |
| `C:\Users\homec\Downloads\111111\0001.mp3` |  |  |
