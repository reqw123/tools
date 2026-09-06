# 自動化測試

```
python -m pytest            # 全部
python -m pytest tests/test_index_repository.py -q
python -m pytest -k sticky  # 只跑名字含 sticky 的
```

`pytest.ini` 已設好 `pythonpath = .`，從專案根目錄跑即可，不用先 `pip install`。

## 涵蓋範圍

| 層 | 檔案 | 重點 |
|---|---|---|
| 原子寫檔 | `test_atomic_io.py` | 建立父目錄、原子替換、失敗清暫存 |
| 資料模型／樣式 | `test_models_and_styles.py` | `format_added_at`、`IndexEntry` 衍生屬性、`darken`/`lighten`/`icon_for` |
| 子行程啟動 | `test_worker_launch.py` | 打包／非打包兩種 argv |
| 索引 .md 讀寫 | `test_index_repository.py` | 表格解析、空分類、`append_rows` 批次、依序號精確更新／刪除、清理失效列、檔名驗證 |
| 加入時間／常用資料夾 | `test_metadata_repository.py` | 批次寫時間、損毀容錯、刪索引清孤兒 |
| cache/usage/prefs/settings | `test_small_repositories.py` | SHA-256、形狀容錯、**計數器多執行緒不掉數**、**prefs 손壞不炸**、API Key 不落地可攜檔／舊版遷移 |
| 便利貼 | `test_sticky_note.py` | CRUD via `mutate`、找不到 id 不寫檔、搜尋、標籤配色穩定、**AI 回應解析（JSON／圍欄／list_tags／空 answer／舊格式／壞 ids）**、export 圍欄避開反引號 |
| 搜尋篩選 | `test_search_service.py` | 分類／資料夾／關鍵字／快取全文、保留序號 |
| 掃描／匯入 | `test_scan_and_import.py` | 遞迴＋副檔名、類別計數加總、**`path_key` 大小寫一致去重**、DnD 解析、資料夾匯入批次委派 |
| 索引 Service | `test_index_service.py` | 單一／聚合序號、依 row_index 更新刪除、刪索引連帶清快取＋時間、清理流程 |
| 內容快取／重複偵測 | `test_cache_and_duplicate.py` | 重算判斷、修剪孤兒、轉錄文字不截斷、只回真的重複組 |
| 人工批次補說明 | `test_description_service.py` | 找空說明、圖片給空字串、取消、只補說明不動分類 |
| 文件內容擷取 | `test_preview_service.py` | 純文字截斷、二進位偵測、docx/xlsx/zip 擷取、UTF-16 BOM、缺 Pillow 安全 |
| AI Provider | `test_ai_providers.py` | HTTP 錯誤包成 `AIProviderError`、OpenAI 推理模型參數重試、**Ollama 非字串回應包成例外**、視覺模型檢查、URL 正規化 |
| AI 說明 Service | `test_ai_description_service.py` | 設定判斷、去向摘要、記帳、逐筆產生／取消／provider 錯誤捕捉、單檔即席分析 |
| 播放控制 | `test_media_controller.py` | `format_ms`、無 VLC 時所有呼叫都安全 |
| Tk 煙霧 | `test_ui_smoke.py` | 惰性建列＋上限（批次刪除／AI 批次／重複偵測）、搜尋去抖動、便利貼 AI 結果失效、預覽背景擷取的失效防護、**AISelectDialog 取消線路**、MainWindow 整體組裝 |

沒有 GUI 的環境會自動 skip `test_ui_smoke.py`（見 `conftest.tk_root`）。
faster-whisper／python-vlc／pypdf 沒裝也不影響——對應測試走的都是「缺套件時的降級路徑」。
