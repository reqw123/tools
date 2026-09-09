# 放寬範圍：索引集層級的「新增空白／刪除／開編輯器」也搬上網頁

`0001` 把「索引集本身的建立／刪除（`.md` 檔）」明確劃給桌面版；`0003` 放寬到
「索引集層級的**匯入**（＝用既有 `.md` 建立一份新的）」與**匯出**，但仍把
**建立空白**、**刪除**留給桌面版。使用者後來要求索引 MD 牆的工具列比照桌面版
補齊索引集層級的操作按鈕（做成跟「匯入／匯出索引集」一樣的正方形小圖示按鈕，
排在「匯出索引集」右邊、總項目數左邊）。這份 ADR 再放寬一格，補上桌面版
索引集選單裡剩下的三個動作：

- **新增索引集（🗂 建立空白）**：在 `indexes/` 底下建立一份新的空白 `.md`，
  開頭附一段格式規定前言、只有空表格。內容用內建範本
  （`store.ts` 的 `DEFAULT_INDEX_TEMPLATE`，移植自桌面版
  `IndexRepository._DEFAULT_INDEX_TEMPLATE`）。跟 `0003` 的「匯入」共用
  `validateIndexName()`，差別只在內容來源（範本 vs 使用者挑的檔）。
  端點 `POST /indexes`（body `{name}`）。前端 `CreateIndexDialog`
  比照 `ImportIndexDialog`，只是拿掉選檔那一步。對應桌面版
  `_on_create_index` → `IndexRepository.create_index_file()`。
- **刪除索引集（🗑️ 刪整份 `.md`）**：把 `indexes/` 底下這份 `.md` 整個
  刪掉。**只刪索引紀錄，絕不碰硬碟上被索引的實體檔案**（跟項目層級「移除」
  的鐵則一致）。比照桌面版的二次確認：`DeleteIndexDialog` 顯示索引集名稱＋
  項目筆數，要按「確定刪除」才送出。端點 `DELETE /indexes/:name`。
  對應桌面版 `_on_delete_index` → `IndexService.delete_index()`——但
  files-web **沒有**全文快取／加入時間紀錄（那些只在桌面版），分類自訂顏色
  是以分類名為鍵、跨索引集共用，所以這裡不需要像桌面版那樣清附屬資料，
  單純 `unlinkSync`。
- **編輯索引集（用系統文字編輯器開這份 `.md`）**：在跑 server 的那台電腦
  用 VS Code（退回記事本／`open -t`／`xdg-open`）開啟這份 `.md`，讓使用者
  手動改前言 prose／路徑／格式——也就是這個 app 一直沒做的那幾件事，交給
  真正的編輯器而不是在網頁裡重造一個。端點 `POST /indexes/:name/edit`。
  對應桌面版「編輯索引檔案」（`_open_index_file` →
  `file_actions.open_in_text_editor`：優先 VS Code、退回記事本）。跟
  `openInExplorer`／`/open` 一樣是本機動作，靠 server 只綁 `127.0.0.1` 把關；
  在非本機的瀏覽器分頁按下去，只會在跑 server 的那台電腦開窗。

## 仍然不做

- **改路徑**（要換路徑＝移除再重加）、在網頁 UI 裡直接編輯前言 prose
  （現在的答案是「開編輯器自己改」）。
- **重新命名索引集**：桌面版本身也沒有這個功能，這裡跟著不做。
- 全文快取、重複偵測、AI 全文搜尋、音訊／影片轉錄——維持 `0001`～`0003`
  的範圍決定。

## 後果

- `store.ts` 又多一份跟桌面版 `IndexRepository` 對應的移植：
  `DEFAULT_INDEX_TEMPLATE`（＝`_DEFAULT_INDEX_TEMPLATE`）、`createBlankIndex()`
  （＝`create_index_file()`）、`deleteIndex()`（＝`delete_index_file()`，
  但少了清快取／metadata 那兩步）、`openIndexInEditor()`
  （＝`file_actions.open_in_text_editor`）。範本前言文字若在桌面版那邊
  drift，只影響**新建**索引集的前言、不影響解析，但兩邊仍儘量保持一致。
- 後端多了 `POST /indexes`、`DELETE /indexes/:name`、
  `POST /indexes/:name/edit`。前兩者是既有 `.md` 讀寫能力的延伸；
  `edit` 跟 `/open` 一樣會 shell 出本機程式，不是新的安全邊界
  （server 只綁 loopback，`0001` 就靠這個把關）。
- `CONTEXT-MAP.md`「file_search_app → files-web」那段原本寫「索引集的**刪除**
  仍只在桌面版」——這份 ADR 之後不再成立，該處已一併更新。
- 桌面版與 files-web 現在**索引集層級**的能力幾乎對齊（新增空白／匯入／
  匯出／刪除／開編輯器都有），只差「重新命名」（兩邊都沒有）與桌面版刪除時
  一併清的快取／metadata（files-web 沒有那些東西）。
