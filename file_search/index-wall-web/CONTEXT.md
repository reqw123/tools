# 索引牆 · index-wall-web

`file_search_app` 的**檔案索引**網頁版：一次挑一份 `.md` 索引集，用網頁 UI
呈現裡面的項目（搜尋、依分類／資料夾篩選、標示已遺失的檔案），並可維護項目
——加入單筆、原地編輯分類／說明、移除單筆、批次匯入資料夾、批次補說明（可用
AI）、批次刪除（一律只動 `.md` 表格列，不碰實體檔案——見 `docs/adr/0002`）。跟便利貼版 `sticky-wall-web`
是同層的兩個獨立分流，共用技術棧、不共用程式碼。「批次補說明」的 AI 模式跟
便利貼牆一樣，靠 `server/ai_bridge.py` 子行程呼叫桌面版的 `AIDescriptionService`。

## Language

**索引集（Index Set）**：
`indexes/` 底下的一個 `.md` 檔，是一組手動維護的檔案索引；使用者一次檢視一份。
_Avoid_: 索引檔, index file, 資料庫

**索引項目（Index Entry）**：
索引集表格裡的一列——一個檔案的完整路徑，加上分類與說明兩欄。
_Avoid_: 檔案, row, record, 資料

**分類（Category）**：
索引項目上的自由文字歸類欄，可留空（留空＝「未分類」）。跟便利貼的「標籤」是
不同概念，這個 app 一律講「分類」。
_Avoid_: 標籤, tag, label

**說明（Description）**：
索引項目上的自由文字欄，放一句話說明或搜尋用的關鍵字。
_Avoid_: 備註, comment, 註解

**前言（Preamble）**：
索引集檔案開頭、表格以外的敘述文字（通常是格式規定說明）。UI 把它折疊起來、
需要時 render 成 HTML。
_Avoid_: header, 說明文件, intro

**遺失項目（Missing Entry）**：
路徑指向的檔案在磁碟上已經不存在的索引項目；UI 要明顯標示。
_Avoid_: broken link, dead entry, 壞掉的
