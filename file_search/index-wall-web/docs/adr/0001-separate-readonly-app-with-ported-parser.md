# 另開唯讀 app，並把索引表格 parser 重寫成 TypeScript

`file_search_app` 的 `.md` 檔案索引需要一個網頁檢視器。既有做法（`sticky-wall-web`）
是讓 Node 後端 spawn `ai_bridge.py` 去呼叫 `file_search_app` 的既有服務，藉此不重寫
任何邏輯。這裡**刻意不沿用**那個模式：`index-wall-web` 是獨立資料夾、獨立部署，
後端用一段 ~10 行的 TypeScript 正則自己解析索引表格（移植 `IndexRepository._ROW_RE`），
不依賴 Python。

理由：這個 app 純唯讀、只解析不寫回，parser 邏輯小且穩定（格式規定寫死在每份索引
的前言裡、幾年沒變）；為了一個純讀取操作背一個 Python runtime 相依不划算。代價是
`_ROW_RE` 的邏輯現在有兩份實作——若日後索引表格格式改變，兩邊都要改；`CONTEXT.md`
的「索引項目」定義是這個對應關係的單一事實來源。

「唯讀、不做 AI／媒體／匯出／編輯」是明確的範圍決定，不是尚未實作——完整編輯器
是桌面版的職責，這個分流只做「華麗呈現」。
